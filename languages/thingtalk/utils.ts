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
import type { ThingpediaLoader } from './load-thingpedia';

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

function makeFilter(loader : ThingpediaLoader,
                    pname : Ast.Value,
                    op : string,
                    value : Ast.Value,
                    negate ?: false) : Ast.AtomBooleanExpression|null;
function makeFilter(loader : ThingpediaLoader,
                    pname : Ast.Value,
                    op : string,
                    value : Ast.Value,
                    negate : true) : Ast.NotBooleanExpression|null;
function makeFilter(loader : ThingpediaLoader,
                    pname : Ast.Value,
                    op : string,
                    value : Ast.Value,
                    negate : boolean) : Ast.AtomBooleanExpression|Ast.NotBooleanExpression|null;
function makeFilter(loader : ThingpediaLoader,
                    pname : Ast.Value,
                    op : string,
                    value : Ast.Value,
                    negate = false) : Ast.BooleanExpression|null {
    assert(pname instanceof Ast.Value.VarRef);
    const vtype = value.getType();
    let ptype = vtype;
    if (ptype instanceof Type.Entity && ptype.type === 'tt:url')
        return null;
    if (op === 'contains') {
        if (loader.params.out.has(pname.name + '+' + Type.RecurrentTimeSpecification) && (vtype.isTime || vtype.isDate))
            ptype = Type.RecurrentTimeSpecification;
        else
            ptype = new Type.Array(vtype);
        if (vtype.isString)
            op = 'contains~';
    } else if (op === '==' && vtype.isString) {
        op = '=~';
    }
    if (!loader.params.out.has(pname.name + '+' + ptype) && pname.name !== 'id')
        return null;

    const f = new Ast.BooleanExpression.Atom(null, pname.name, op, value);
    if (negate)
        return new Ast.BooleanExpression.Not(null, f);
    else
        return f;
}

function makeAndFilter(loader : ThingpediaLoader,
                       param : Ast.Value,
                       op : string,
                       values : Ast.Value[],
                       negate=false) : Ast.BooleanExpression|null {
    if (values.length !== 2)
        return null;
    if (values[0].equals(values[1]))
        return null;
    const operands  = values.map((v) => makeFilter(loader, param, op, v));
    if (operands.includes(null))
        return null;
    const f = new Ast.BooleanExpression.And(null, operands);
    if (negate)
        return new Ast.BooleanExpression.Not(null, f);
    return f;
}

function makeDateRangeFilter(loader : ThingpediaLoader,
                             param : Ast.Value,
                             values : Ast.Value[]) : Ast.BooleanExpression|null {
    if (values.length !== 2)
        return null;
    const operands = [
        makeFilter(loader, param, '>=', values[0]),
        makeFilter(loader, param, '<=', values[1])
    ];
    if (operands.includes(null))
        return null;
    return new Ast.BooleanExpression.And(null, operands);
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

function isSameFunction(fndef1 : Ast.ExpressionSignature,
                        fndef2 : Ast.ExpressionSignature) : boolean {
    if (!(fndef1 instanceof Ast.FunctionDef) ||
        !(fndef2 instanceof Ast.FunctionDef)) // a join
        return false;
    if (!fndef1.class || !fndef2.class)
        return false;
    return fndef1.class.name === fndef2.class.name &&
        fndef1.name === fndef2.name;
}

function isExecutable(stmt : Ast.Statement) : boolean {
    let hasUndefined = false;
    const visitor = new class extends Ast.NodeVisitor {
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
                        hasUndefined = true;
                }
            }

            return true;
        }

        visitValue(value : Ast.Value) {
            if (value.isUndefined)
                hasUndefined = true;
            return true;
        }
    };
    stmt.visit(visitor);
    return !hasUndefined;
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

export function isUnaryTableToTableOp(table : Ast.Table) : boolean {
    return table.isFilter ||
        table.isProjection ||
        table.isCompute ||
        table.isAlias ||
        table.isSort ||
        table.isIndex ||
        table.isSlice ||
        table.isAggregation;
}
export function isUnaryStreamToTableOp(table : Ast.Table) : boolean {
    return false;
}
export function isUnaryStreamToStreamOp(stream : Ast.Stream) : boolean {
    return stream.isEdgeNew ||
        stream.isEdgeFilter ||
        stream.isFilter ||
        stream.isProjection ||
        stream.isCompute ||
        stream.isAlias;
}
export function isUnaryTableToStreamOp(stream : Ast.Stream) : boolean {
    return stream.isMonitor;
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
