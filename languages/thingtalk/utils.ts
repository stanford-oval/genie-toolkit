// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
//           2019 National Taiwan University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//         Elvis Yu-Jing Lin <r06922068@ntu.edu.tw> <elvisyjlin@gmail.com>

import assert from 'assert';
import { Ast, Type } from 'thingtalk';
import type { I18n } from 'genie-toolkit';

// slot objects to track filters, input and output parameters
// these objects are similar to the Ast node they wrap
// but they also add the function name, so we don't mix parameters
// across functions with the same name

export interface Placeholder {
    type : Type;
}

export interface ParamSlot {
    schema : Ast.FunctionDef;
    name : string;
    type : Type;
    filterable : boolean;
    ast : Ast.VarRefValue;
}

// used by filters of the form "the number of <compound param> that have <filter> in <table>"
export interface FilterValueSlot {
    schema : Ast.FunctionDef;
    name : string;
    ast : Ast.FilterValue;
}

export interface FilterSlot {
    schema : Ast.FunctionDef;
    ptype : Type;
    ast : Ast.BooleanExpression;
}

// a filter not tied to a specific function
// this is used for certain domain-independent templates like "nearby"
export interface DomainIndependentFilterSlot {
    schema : null;
    ptype : Type|null;
    ast : Ast.BooleanExpression;
}

export interface InputParamSlot {
    schema : Ast.FunctionDef;
    ptype : Type;
    ast : Ast.InputParam;
}

function typeToStringSafe(type : Type) : string {
    if (type instanceof Type.Array)
        return 'Array__' + typeToStringSafe(type.elem as Type);
    else if (type instanceof Type.Entity)
        return 'Entity__' + type.type.replace(':', '__');
    else if (type instanceof Type.Measure)
        return 'Measure_' + type.unit;
    else if (type instanceof Type.Enum)
        return 'Enum__' + type.entries!.join('__');
    else
        return String(type);
}

function clean(name : string) : string {
    if (/^[vwgp]_/.test(name))
        name = name.substr(2);
    return name.replace(/_/g, ' ').replace(/([^A-Z ])([A-Z])/g, '$1 $2').toLowerCase();
}

export function makeInputParamSlot(slot : ParamSlot,
                                   value : Ast.Value) : InputParamSlot|null {
    const vtype = value.getType();
    const ptype = slot.type;

    if (!Type.isAssignable(ptype, vtype))
        return null;

    return { schema: slot.schema, ptype : slot.type,
        ast: new Ast.InputParam(null, slot.name, value) };
}

export function makeDomainIndependentFilter(pname : string,
                                            op : string,
                                            value : Ast.Value) : DomainIndependentFilterSlot {
    return { schema: null, ptype: value.getType(),
        ast: new Ast.AtomBooleanExpression(null, pname, op, value, null) };
}

function makeFilter(slot : ParamSlot,
                    op : string,
                    value : Ast.Value,
                    negate = false) : FilterSlot|null {
    const vtype = value.getType();
    const ptype = slot.type;
    // XXX url filters?
    if (ptype instanceof Type.Entity && ptype.type === 'tt:url')
        return null;

    if (op === 'contains') {
        if (ptype === Type.RecurrentTimeSpecification) {
            if (!(vtype.isTime || vtype.isDate))
                return null;
        } else {
            if (!(ptype instanceof Type.Array))
                return null;

            const elem = ptype.elem as Type;
            if ((vtype.isEnum && elem.isEnum) || (vtype.isEntity && elem.isEntity)) {
                if (!Type.isAssignable(vtype, elem))
                    return null;
            } else if (!ptype.equals(elem)) {
                return null;
            }
        }
        if (vtype.isString)
            op = 'contains~';
    } else if (op === 'in_array') {
        if (vtype.equals(new Type.Array(Type.String)) && ptype.isEntity)
            op = 'in_array~';
        else if (!vtype.equals(new Type.Array(ptype)))
            return null;
    } else {
        // note: we need to use "isAssignable" instead of "equals" here
        // to handle enums and entities correctly
        if ((vtype.isEnum && ptype.isEnum) || (vtype.isEntity && ptype.isEntity)) {
            if (!Type.isAssignable(vtype, ptype))
                return null;
        } else if (!ptype.equals(vtype)) {
            return null;
        }

        if (op === '==' && vtype.isString)
            op = '=~';
    }

    let ast = new Ast.BooleanExpression.Atom(null, slot.name, op, value);
    if (negate)
        ast = new Ast.BooleanExpression.Not(null, ast);
    return { schema: slot.schema, ptype, ast };
}

function makeAndFilter(slot : ParamSlot,
                       op : string,
                       values : [Ast.Value, Ast.Value],
                       negate=false) : FilterSlot|null {
    if (values.length !== 2)
        return null;
    if (values[0].equals(values[1]))
        return null;
    const operands = [
        makeFilter(slot, op, values[0]),
        makeFilter(slot, op, values[1])
    ];
    if (operands[0] === null || operands[1] === null)
        return null;
    let ast = new Ast.BooleanExpression.And(null, [operands[0].ast, operands[1].ast]);
    if (negate)
        ast = new Ast.BooleanExpression.Not(null, ast);
    return { schema: slot.schema, ptype: slot.type, ast };
}

function makeDateRangeFilter(slot : ParamSlot,
                             values : Ast.Value[]) : FilterSlot|null {
    if (values.length !== 2)
        return null;
    const operands = [
        makeFilter(slot, '>=', values[0]),
        makeFilter(slot, '<=', values[1])
    ] as const;
    if (operands[0] === null || operands[1] === null)
        return null;
    const ast = new Ast.BooleanExpression.And(null, [operands[0].ast, operands[1].ast]);
    return { schema: slot.schema, ptype: slot.type, ast };
}

function isHumanEntity(type : Type|string) : boolean {
    if (type instanceof Type.Entity)
        return isHumanEntity(type.type);
    if (type instanceof Type.Array)
        return isHumanEntity(type.elem);
    if (typeof type !== 'string')
        return false;
    if (['tt:contact', 'tt:username', 'org.wikidata:human'].includes(type))
        return true;
    if (type.startsWith('org.schema') && type.endsWith(':Person'))
        return true;
    return false;
}

function isLocationEntity(type : Type) : boolean {
    if (type === Type.Location)
        return true;
    if (type instanceof Type.Array)
        return isLocationEntity(type.elem as Type);

    // FIXME: other types that can be asked by "where" question (e.g., organization)
    return false;
}

function isTimeEntity(type : Type) : boolean {
    if (type.isDate)
        return true;
    if (type.isTime)
        return true;
    if (type.isRecurrentTimeSpecification)
        return true;
    return false;
}

function interrogativePronoun(type : Type) : 'who'|'where'|'when'|'what' {
    if (isHumanEntity(type))
        return 'who';
    if (isLocationEntity(type))
        return 'where';
    if (isTimeEntity(type))
        return 'when';

    // FIXME: other interrogative pronouns (e.g., "how" for health condition, "how much" for price)
    return 'what';
}

const PARAM_REGEX = /\$(?:\$|([a-zA-Z0-9_]+(?![a-zA-Z0-9_]))|{([a-zA-Z0-9_]+)(?::([a-zA-Z0-9_-]+))?})/;

function* split(pattern : string, regexp : RegExp|string) : Generator<string|string[], void> {
    // a split that preserves capturing parenthesis

    const clone = new RegExp(regexp, 'g');
    let match = clone.exec(pattern);

    let i = 0;
    while (match !== null) {
        if (match.index > i)
            yield pattern.substring(i, match.index);
        yield match;
        i = clone.lastIndex;
        match = clone.exec(pattern);
    }
    if (i < pattern.length)
        yield pattern.substring(i, pattern.length);
}

function splitParams(utterance : string) : Array<string|string[]> {
    return Array.from(split(utterance, PARAM_REGEX));
}

function tokenizeExample(tokenizer : I18n.BaseTokenizer,
                         utterance : string,
                         id : number) : string {
    let replaced = '';
    const params : Array<[string, string]> = [];

    for (const chunk of splitParams(utterance.trim())) {
        if (chunk === '')
            continue;
        if (typeof chunk === 'string') {
            replaced += chunk;
            continue;
        }

        const [match, param1, param2, opt] = chunk;
        if (match === '$$') {
            replaced += '$';
            continue;
        }
        const param = param1 || param2;
        replaced += ' ____ ';
        params.push([param, opt]);
    }

    const tokenized = tokenizer.tokenize(replaced);
    const tokens = tokenized.tokens;
    const entities = tokenized.entities;

    if (Object.keys(entities).length > 0)
        throw new Error(`Error in Example ${id}: Cannot have entities in the utterance`);

    let preprocessed = '';
    let first = true;
    for (let token of tokens) {
        if (token === '____') {
            const [param, opt] = params.shift()!;
            if (opt)
                token = '${' + param + ':' + opt + '}';
            else
                token = '${' + param + '}';
        } else if (token === '$') {
            token = '$$';
        }
        if (!first)
            preprocessed += ' ';
        preprocessed += token;
        first = false;
    }

    return preprocessed;
}

function isSameFunction(fndef1 : Ast.FunctionDef,
                        fndef2 : Ast.FunctionDef) : boolean {
    assert(fndef1);
    assert(fndef2);
    if (fndef1 === fndef2)
        return true;
    return fndef1.qualifiedName === fndef2.qualifiedName;
}

class HasUndefinedVisitor extends Ast.NodeVisitor {
    hasUndefined = false;

    visitInvocation(invocation : Ast.Invocation) {
        const schema = invocation.schema;
        assert(schema instanceof Ast.FunctionDef);
        const requireEither = schema.getAnnotation<string[][]>('require_either');
        if (requireEither) {
            const params = new Set;
            for (const in_param of invocation.in_params)
                params.add(in_param.name);

            for (const requirement of requireEither) {
                let satisfied = false;
                for (const option of requirement) {
                    if (params.has(option)) {
                        satisfied = true;
                        break;
                    }
                }
                if (!satisfied)
                    this.hasUndefined = true;
            }
        }

        return true;
    }

    visitValue(value : Ast.Value) {
        if (value.isUndefined)
            this.hasUndefined = true;
        return true;
    }
}

function isExecutable(stmt : Ast.Statement) : boolean {
    const visitor = new HasUndefinedVisitor();
    stmt.visit(visitor);
    return !visitor.hasUndefined;
}

/**
 * Normalize the #[confirm] annotation.
 *
 * #[confirm] is a three-state enum annotation with values:
 * - #[confirm=enum(confirm)]: must confirm explicitly with all parameters before the
 *   function is called (using a statement with #[confirm=enum(confirmed)] annotation)
 * - #[confirm=enum(display_result)]: the result of any query that feeds into the parameters
 *   of this function should be displayed before the function is executed; this is encoded
 *   by splitting any compound statement into two statements, executed sequentially
 * - #[confirm=enum(auto)]: the function can be called without explicit confirmation, even
 *   if some of the parameters are coming from other functions; this is the only #[confirm]
 *   that allows the function to be called multiple times in a single statement
 *
 * For legacy/ease of development reasons, if unspecified #[confirm] defaults to "confirm"
 * for actions (full confirmation before executing side effects) and "display_result" for
 * queries (splitting table joins into two statements).
 *
 * Also, #[confirm] can be specified as a boolean: "true" means "confirm" and "false" means
 * "display_result".
 */
function normalizeConfirmAnnotation(fndef : Ast.FunctionDef) : 'confirm' | 'display_result' | 'auto' {
    const value = fndef.getAnnotation('confirm');
    if (value === undefined) // unspecified
        return fndef.functionType === 'action' ? 'confirm' : 'display_result';

    if (typeof value === 'boolean')
        return value ? 'confirm' : 'display_result';

    assert(value === 'confirm' || value === 'display_result' || value === 'auto');
    return value;
}

export {
    clean,

    split,
    splitParams,
    tokenizeExample,

    isExecutable,
    normalizeConfirmAnnotation,

    isSameFunction,

    typeToStringSafe,
    makeFilter,
    makeAndFilter,
    makeDateRangeFilter,

    isHumanEntity,
    isLocationEntity,
    isTimeEntity,
    interrogativePronoun
};
