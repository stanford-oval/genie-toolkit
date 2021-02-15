// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
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

import assert from 'assert';
import { Ast, Type } from 'thingtalk';

import type { SlotBag } from './slot_bag';
import type {
    Placeholder,
    ExpressionWithCoreference,
    ErrorMessage,
    ParamSlot,
    FilterSlot,
    DomainIndependentFilterSlot,
    InputParamSlot,
} from './utils';
import {
    getImplicitParameterPassing
} from './ast_manip';

// Key functions: given the result of a semantic function, compute
// a set of keys to speed-up derivation matching

export function placeholderKeyFn(pl : Placeholder) {
    return { type: pl.type, is_numeric: pl.type.isNumeric() };
}

export function valueKeyFn(value : Ast.Value) {
    const type = value.getType();
    return { type, is_numeric: type.isNumeric(), is_constant: value.isConstant() };
}

export function valueArrayKeyFn(values : Ast.Value[]) {
    const type = values[0].getType();
    return { type, is_numeric: type.isNumeric() };
}

export function entityOrNumberValueKeyFn(value : Ast.EntityValue|Ast.NumberValue) {
    const type = value.getType();
    return { type,is_numeric: type.isNumeric(), value: value.value };
}

export function filterKeyFn(slot : FilterSlot|DomainIndependentFilterSlot) {
    const schema = slot.schema;
    const id = schema?.getArgument('id');
    return {
        functionName: schema ? schema.qualifiedName : null,
        type: slot.ptype,
        is_numeric: slot.ptype ? slot.ptype.isNumeric() : false,
        associatedIdType: id && !id.is_input ? id.type : null
    };
}

export function inputParamKeyFn(slot : InputParamSlot) {
    return { functionName: slot.schema.qualifiedName, type: slot.ptype };
}

export function paramKeyFn(slot : ParamSlot) {
    const id = slot.schema.getArgument('id');
    return {
        functionName: slot.schema.qualifiedName,
        type: slot.type,
        is_numeric: slot.type.isNumeric(),
        elem: slot.type instanceof Type.Array ? slot.type.elem as Type : null,
        is_numeric_elem: slot.type instanceof Type.Array ? (slot.type.elem as Type).isNumeric() : false,
        associatedIdType: id && !id.is_input ? id.type : null,
        filterable: slot.filterable
    };
}

export function paramArrayKeyFn(slots : ParamSlot[]) {
    if (slots.length === 0)
        return { functionName: null, type: null, associatedIdType: null, filterable: true };

    const id = slots[0].schema.getArgument('id');
    return { functionName: slots[0].schema.qualifiedName, type: slots[0].type,
        associatedIdType: id && !id.is_input ? id.type : null,
        filterable: slots.every((s) => s.filterable) };
}

export function functionDefKeyFn(fndef : Ast.FunctionDef) {
    return { functionName: fndef.qualifiedName };
}

export function expressionKeyFn(expr : Ast.Expression) {
    const schema = expr.schema!;
    const geo = schema.getArgument('geo');
    const id = schema.getArgument('id');

    let isEventProjection = false;
    let projectionType = null;
    let implicitParamPassingType = null;
    if (expr instanceof Ast.MonitorExpression)
        expr = expr.expression;
    if (expr instanceof Ast.ProjectionExpression) {
        if (expr.args.length === 1 && expr.computations.length === 0) {
            isEventProjection = expr.args[0] === '$event';
            if (isEventProjection)
                projectionType = Type.String;
            else
                projectionType = schema.getArgType(expr.args[0])!;
        } else if (expr.computations.length === 1 && expr.args.length === 0) {
            projectionType = expr.computations[0].getType();
        }
    } else {
        const paramPassing = getImplicitParameterPassing(expr.schema!);
        if (paramPassing === '$event')
            implicitParamPassingType = Type.String;
        else
            implicitParamPassingType = schema.getArgType(paramPassing)!;
    }
    assert(projectionType !== undefined);

    return {
        functionName: schema.qualifiedName,
        is_list: schema.is_list,
        is_monitorable: schema.is_monitorable,
        has_geo: !!(geo && geo.type === Type.Location),
        projectionType,
        isEventProjection,
        implicitParamPassingType,
        idType: id && !id.is_input ? id.type : null
    };
}

export function invocationKeyFn(expr : Ast.Invocation) {
    const schema = expr.schema!;
    const geo = schema.getArgument('geo');
    const id = schema.getArgument('id');

    return {
        functionName: schema.qualifiedName,
        is_list: schema.is_list,
        is_monitorable: schema.is_monitorable,
        has_geo: !!(geo && geo.type === Type.Location),
        idType: id && !id.is_input ? id.type : null
    };
}

export function slotBagKeyFn(expr : SlotBag) {
    const id = expr.schema?.getArgument('id');
    return {
        functionName: expr.schema ? expr.schema.qualifiedName : null,
        idType: id && !id.is_input ? id.type : null
    };
}

export function errorMessageKeyFn(msg : ErrorMessage) {
    return {
        functionName: msg.bag.schema ? msg.bag.schema.qualifiedName : null,
    };
}

export function expressionStatementKeyFn(expr : Ast.ExpressionStatement) {
    const schema = expr.expression.schema!;
    return { functionName: schema.qualifiedName };
}

export function argMinMaxKeyFn(argminmax : [ParamSlot, 'asc' | 'desc']) {
    return paramKeyFn(argminmax[0]);
}

export function expressionWithCoreferenceKeyFn(coref : ExpressionWithCoreference) {
    const schema = coref.expression.schema!;
    const id = schema.getArgument('id');

    return {
        // standard expression keys
        functionName: schema.qualifiedName,
        idType: id && !id.is_input ? id.type : null,

        // coref specific keys
        corefType: coref.type,
        corefFunctionName: coref.slot ? coref.slot.schema.qualifiedName : null,
    };
}
