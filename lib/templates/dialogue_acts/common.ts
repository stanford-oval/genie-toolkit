// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
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

import { Ast, } from 'thingtalk';

import * as C from '../ast_manip';
import { arraySubset } from '../array_utils';
import {
    setOrAddInvocationParam,
} from '../state_manip';
import { SlotBag } from '../slot_bag';


function isFilterCompatibleWithInfo(info : SlotBag, filter : Ast.BooleanExpression) : boolean {
    assert(filter instanceof Ast.BooleanExpression);
    if (filter.isTrue || filter.isDontCare)
        return true;
    if (filter.isFalse)
        return false;
    if (filter instanceof Ast.OrBooleanExpression)
        return filter.operands.some((op) => isFilterCompatibleWithInfo(info, op));
    if (filter instanceof Ast.AndBooleanExpression)
        return filter.operands.every((op) => isFilterCompatibleWithInfo(info, op));
    if (filter instanceof Ast.NotBooleanExpression)
        return !isFilterCompatibleWithInfo(info, filter.expr);

    // approximate
    if (filter.isExternal || filter.isCompute)
        return true;

    assert(filter instanceof Ast.AtomBooleanExpression);
    const pname = filter.name;
    if (!info.has(pname))
        return false;

    if (!filter.value.isConstant())
        return true;

    switch (filter.operator) {
    case '==':
    case '=~':
        return filter.value.equals(info.get(pname)!);

    case 'contains':
    case 'contains~':
        return (info.get(pname) as Ast.ArrayValue).value.some((v) => v.equals(filter.value));

    case 'in_array':
    case 'in_array~':
        return (filter.value as Ast.ArrayValue).value.some((v) => v.equals(info.get(pname)!));

    case '>=':
        return (info.get(pname)!.toJS() as number) >= (filter.value.toJS() as number);
    case '<=':
        return (info.get(pname)!.toJS() as number) <= (filter.value.toJS() as number);

    default:
        // approximate
        return true;
    }
}

function isFilterCompatibleWithResult(topResult : Ast.DialogueHistoryResultItem,
                                      filter : Ast.BooleanExpression) : boolean {
    if (filter.isTrue || filter.isDontCare)
        return true;
    if (filter.isFalse)
        return false;
    if (filter instanceof Ast.AndBooleanExpression)
        return filter.operands.every((op) => isFilterCompatibleWithResult(topResult, op));
    if (filter instanceof Ast.OrBooleanExpression)
        return filter.operands.some((op) => isFilterCompatibleWithResult(topResult, op));
    if (filter instanceof Ast.NotBooleanExpression)
        return !isFilterCompatibleWithResult(topResult, filter.expr);

    if (filter.isExternal) // approximate
        return true;

    if (filter.isCompute) // approximate
        return true;

    assert(filter instanceof Ast.AtomBooleanExpression);
    const values = topResult.value;

    // if the value was not returned, don't verbalize it
    if (!values[filter.name])
        return false;

    const resultValue = topResult.value[filter.name];

    if (resultValue instanceof Ast.EntityValue) {
        // approximate: all strings are made up so we don't need a true likeTest here
        if (filter.operator === '=~')
            return resultValue.display === filter.value.toJS();
        else
            return String(resultValue.toJS()) === String(filter.value.toJS());
    }

    switch (filter.operator) {
    case '==':
    case '=~':
        // approximate: all strings are made up so we don't need a true likeTest here
        return String(resultValue.toJS()) === String(filter.value.toJS());

    default:
        // approximate
        return true;
    }
}

export function isSlotCompatibleWithResult(topResult : Ast.DialogueHistoryResultItem,
                                           pname : string, infoValue : Ast.Value) {
    const resultValue = topResult.value[pname];
    if (!resultValue)
        return false;

    if (resultValue instanceof Ast.ArrayValue && infoValue instanceof Ast.ArrayValue) {
        if (!arraySubset(infoValue.value, resultValue.value))
            return false;
    } else {
        if (!resultValue.equals(infoValue))
            return false;
    }

    return true;
}

function isInfoPhraseCompatibleWithResult(topResult : Ast.DialogueHistoryResultItem, info : SlotBag) {
    for (const [pname, infoValue] of info) {
        if (!isSlotCompatibleWithResult(topResult, pname, infoValue))
            return false;
    }
    return true;
}

/**
 * Check if asking a question on the parameters "questions" is allowed.
 *
 * This checks two things: that all parameters are valid output parameters of the table,
 * and all parameters are filterable.
 */
function isValidSearchQuestion(expr : Ast.Expression, questions : C.ParamSlot[]) {
    for (const q of questions) {
        if (!C.isSameFunction(q.schema, expr.schema!))
            return false;
        const arg = expr.schema!.getArgument(q.name);
        if (!arg || arg.is_input)
            return false;
        if (arg.getAnnotation('filterable') === false)
            return false;
    }
    return true;
}


function addParametersFromContext(toInvocation : Ast.Invocation, fromInvocation : Ast.Invocation) {
    const newParams = new Set<string>();
    for (const in_param of toInvocation.in_params) {
        if (in_param.value.isUndefined)
            continue;
        newParams.add(in_param.name);
    }

    let cloned = false;

    for (const in_param of fromInvocation.in_params) {
        if (in_param.value.isUndefined)
            continue;
        if (newParams.has(in_param.name))
            continue;

        if (!cloned) {
            toInvocation = toInvocation.clone();
            cloned = true;
        }

        setOrAddInvocationParam(toInvocation, in_param.name, in_param.value);
    }

    return toInvocation;
}

function findChainParam(topResult : Ast.DialogueHistoryResultItem, action : Ast.Invocation) : string|undefined {
    const resultType = topResult.value.id.getType();

    let chainParam : string|undefined = undefined;
    for (const arg of action.schema!.iterateArguments()) {
        if (arg.type.equals(resultType)) {
            chainParam = arg.name;
            break;
        }
    }
    return chainParam;
}

export function isSimpleFilterExpression(table : Ast.Expression) : table is Ast.FilterExpression {
    return table instanceof Ast.FilterExpression && table.expression instanceof Ast.InvocationExpression;
}

export {
    isFilterCompatibleWithInfo,
    isFilterCompatibleWithResult,
    isInfoPhraseCompatibleWithResult,
    isValidSearchQuestion,
    findChainParam,
    addParametersFromContext,
};
