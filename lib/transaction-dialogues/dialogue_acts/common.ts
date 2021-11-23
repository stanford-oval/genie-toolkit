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

import { Ast, Type, } from 'thingtalk';

import * as C from '../../templates/ast_manip';
import { arraySubset } from '../../templates/array_utils';
import { setOrAddInvocationParam } from '../../utils/thingtalk';

import { SlotBag } from '../../templates/slot_bag';
import { POLICY_NAME } from '../metadata';
import { ContextInfo } from '../context-info';
import { AgentReplyRecord } from '../../sentence-generator/types';

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

/**
 * Create a new dialogue state that corresponds to accepting all proposed
 * statements in the given state.
 */
export function acceptAllProposedStatements(state : Ast.DialogueState) {
    if (!state.history.some((item) => item.confirm === 'proposed'))
        return null;

    return new Ast.DialogueState(null, POLICY_NAME, 'execute', null, state.history.flatMap((item) => {
        if (item.results !== null)
            return [];
        if (item.confirm === 'proposed')
            return new Ast.DialogueHistoryItem(null, item.stmt, null, 'accepted');
        else
            return item;
    }));
}

export interface NameList {
    ctx : ContextInfo;
    results : Ast.DialogueHistoryResultItem[];
}

export function nameListKeyFn(list : NameList) {
    const schema = list.ctx.currentFunction!;
    return {
        functionName: schema.qualifiedName,
        idType: schema.getArgType('id')!,
        length: list.results.length,

        id0: list.ctx.key.id0,
        id1: list.ctx.key.id1,
        id2: list.ctx.key.id2,
    };
}

export interface ContextName {
    ctx : ContextInfo;
    name : Ast.Value;
}

export function contextNameKeyFn(name : ContextName) {
    return {
        currentFunction: name.ctx.key.currentFunction
    };
}

export interface AgentReplyOptions {
    end ?: boolean;
    raw ?: boolean;
    numResults ?: number;
}
export { AgentReplyRecord };

/**
 * Construct a reply from the agent, including additional information beyond the new dialogue state.
 *
 * The reply contains:
 * - the agent state (a ThingTalk dialogue state passed to the NLU and NLG networks)
 * //- the agent reply tags (a list of strings that define the context tags on the user side)
 * - the interaction state (the expected type of the reply, if any, and a boolean indicating raw mode)
 * //- extra information for the new context
 */
export function makeAgentReply(ctx : ContextInfo,
                               meaning : Ast.DialogueState,
                               aux : unknown = null,
                               expectedType : Type|null = null,
                               options : AgentReplyOptions = {}) : AgentReplyRecord {
    assert(meaning instanceof Ast.DialogueState);
    assert(meaning.dialogueAct.startsWith('sys_'));
    assert(expectedType === null || expectedType instanceof Type);

    // show a yes/no thing if we're proposing something
    if (expectedType === null && meaning.history.some((item) => item.confirm === 'proposed'))
        expectedType = Type.Boolean;

    // if false, the agent is still listening
    // the agent will continue listening if one of the following is true:
    // - the agent is eliciting a value (slot fill or search question)
    // - the agent is proposing a statement
    // - the agent is asking the user to learn more
    // - there are more statements left to do (includes the case of confirmations)
    let end = options.end;
    if (end === undefined) {
        end = expectedType === null &&
            meaning.dialogueActParam === null &&
            !meaning.dialogueAct.endsWith('_question') &&
            meaning.history.every((item) => item.results !== null);
    }

    //const newContext = ContextInfo.get(state);
    // set the auxiliary information, which is used by the semantic functions of the user
    // to see if the continuation is compatible with the specific reply from the agent
    //newContext.aux = aux;

    /*
    let mainTag;
    if (state.dialogueAct === 'sys_generic_search_question')
        mainTag = contextTable.ctx_sys_search_question;
    else if (state.dialogueAct.endsWith('_question') && state.dialogueAct !== 'sys_search_question')
        mainTag = contextTable['ctx_' + state.dialogueAct.substring(0, state.dialogueAct.length - '_question'.length)];
    else if (state.dialogueAct.startsWith('sys_recommend_') && state.dialogueAct !== 'sys_recommend_one')
        mainTag = contextTable.ctx_sys_recommend_many;
    else if (state.dialogueAct === 'sys_rule_enable_success')
        mainTag = contextTable.ctx_sys_action_success;
    else
        mainTag = contextTable['ctx_' + state.dialogueAct];
    */

    return {
        meaning,

        // the number of results we're describing at this turn
        // (this affects the number of result cards to show)
        numResults: options.numResults || 0,

        expecting: expectedType ?? (end ? null : Type.Any),
        raw: options.raw ?? false,
    };
}

export {
    isFilterCompatibleWithInfo,
    isFilterCompatibleWithResult,
    isInfoPhraseCompatibleWithResult,
    isValidSearchQuestion,
    findChainParam,
    addParametersFromContext,
};
