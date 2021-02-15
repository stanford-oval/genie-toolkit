// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2021 The Board of Trustees of the Leland Stanford Junior University
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

import type { SlotBag } from './slot_bag';

import type ThingpediaLoader from './load-thingpedia';

// slot objects to track filters, input and output parameters
// these objects are similar to the Ast node they wrap
// but they also add the function name, so we don't mix parameters
// across functions with the same name

/**
 * A placeholder of the form "something", "some person", etc.
 */
export interface Placeholder {
    type : Type;
}

/**
 * A phrase that includes a coreference, such as "post this on twitter",
 * "post the caption on twitter", "book it on yelp", "book the restaurant on yelp"
 */
export interface ExpressionWithCoreference {
    // the actual expression
    // for "post this", "book it" and "book the restaurant", it will be something like:
    // ```
    // @com.twitter.post(status=p_status);
    // ```
    // (i.e., `p_status` is still present from the primitive template
    // and can be replaced with other things)
    //
    // for "post the caption", it will be something like:
    // ```
    // @com.twitter.post(status=caption);
    // ```
    // i.e. `p_status` has been replaced already and no further replacement
    // is necessary
    //
    // note that this allows "book the restaurant" to be matched with a query
    // that is not `@com.yelp.restaurant()`, as long as the type matches
    // whereas "post the caption" must be matched with the query where the
    // word "caption" comes from, not just any query that uses the parameter
    // `caption`
    expression : Ast.Expression;

    // the type of the parameter where the coreference is used
    type : Type;

    // the parameter that was used to make the coreference, if any
    // this is null for "post this" and "book the restaurant",
    // and not null for "post the caption"
    slot : ParamSlot|null;

    // the parameter that needs to be replaced with the coreference
    // this is not-null for "post this" and "book the restaurant",
    // and null for "post the caption"
    pname : string|null;
}

export interface ErrorMessage {
    code : string;
    bag : SlotBag;
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

export function makeInputParamSlot(slot : ParamSlot,
                                   value : Ast.Value,
                                   tpLoader : ThingpediaLoader) : InputParamSlot|null {
    const vtype = value.getType();
    const ptype = slot.type;

    if (!Type.isAssignable(ptype, vtype, {}, tpLoader.entitySubTypeMap))
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

function makeFilter(tpLoader : ThingpediaLoader,
                    slot : ParamSlot,
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
                if (!Type.isAssignable(vtype, elem, tpLoader.entitySubTypeMap))
                    return null;
            } else if (!elem.equals(vtype)) {
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
            if (!Type.isAssignable(vtype, ptype, tpLoader.entitySubTypeMap))
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

function makeAndFilter(tpLoader : ThingpediaLoader,
                       slot : ParamSlot,
                       op : string,
                       values : [Ast.Value, Ast.Value],
                       negate = false) : FilterSlot|null {
    if (values.length !== 2)
        return null;
    if (values[0].equals(values[1]))
        return null;
    const operands = [
        makeFilter(tpLoader, slot, op, values[0]),
        makeFilter(tpLoader, slot, op, values[1])
    ];
    if (operands[0] === null || operands[1] === null)
        return null;
    let ast = new Ast.BooleanExpression.And(null, [operands[0].ast, operands[1].ast]);
    if (negate)
        ast = new Ast.BooleanExpression.Not(null, ast);
    return { schema: slot.schema, ptype: slot.type, ast };
}

function makeDateRangeFilter(tpLoader : ThingpediaLoader,
                             slot : ParamSlot,
                             values : Ast.Value[]) : FilterSlot|null {
    if (values.length !== 2)
        return null;
    const operands = [
        makeFilter(tpLoader, slot, '>=', values[0]),
        makeFilter(tpLoader, slot, '<=', values[1])
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

function isSameFunction(fndef1 : Ast.FunctionDef,
                        fndef2 : Ast.FunctionDef) : boolean {
    assert(fndef1);
    assert(fndef2);
    if (fndef1 === fndef2)
        return true;
    return fndef1.qualifiedName === fndef2.qualifiedName;
}

export {
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
