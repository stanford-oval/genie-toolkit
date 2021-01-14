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

import { SlotBag, checkAndAddSlot } from '../slot_bag';
import {
    AgentReplyOptions,
    ContextInfo,
    makeAgentReply,
    makeSimpleState,
    addActionParam,
    addNewItem,
} from '../state_manip';
import {
    isInfoPhraseCompatibleWithResult,
    findChainParam
} from './common';
import {
    refineFilterToAnswerQuestionOrChangeFilter,
    combinePreambleAndRequest,
    proposalReply
} from './refinement-helpers';
import {
    checkInfoPhrase
} from './results';


export interface Recommendation {
    ctx ?: ContextInfo;
    topResult : Ast.DialogueHistoryResultItem;
    info : SlotBag|null;
    action : Ast.Invocation|null;
    hasLearnMore ?: boolean;
    hasAnythingElse ?: boolean;
}

function makeActionRecommendation(ctx : ContextInfo, action : Ast.Invocation) {
    assert(action instanceof Ast.Invocation);

    const results = ctx.results;
    assert(results && results.length > 0);
    const currentStmt = ctx.current!.stmt;
    const currentTable = currentStmt.expression;
    const last = currentTable.last;
    if (last instanceof Ast.SliceExpression && last.limit.toJS() !== 1)
        return null;

    const topResult = results[0];
    const id = topResult.value.id;
    if (!id)
        return null;

    if (action.in_params.length !== 1)
        return null;

    for (const param of action.in_params) {
        if (param.value.equals(id))
            return { topResult, info: null, action };
    }

    return null;
}

function makeArgMinMaxRecommendation(ctx : ContextInfo, name : Ast.Value, base : Ast.Expression, param : C.ParamSlot, direction : 'asc'|'desc') {
    const resultInfo = ctx.resultInfo!;
    if (!resultInfo.argMinMaxField)
        return null;
    if (!C.isSameFunction(base.schema!, ctx.currentFunction!))
        return null;
    if (!C.isSameFunction(param.schema, ctx.currentFunction!))
        return null;
    if (direction !== resultInfo.argMinMaxField[1] ||
        param.name !== resultInfo.argMinMaxField[0])
        return null;

    return makeRecommendation(ctx, name);
}

function makeRecommendation(ctx : ContextInfo, name : Ast.Value) {
    const results = ctx.results;
    assert(results && results.length > 0);
    const currentStmt = ctx.current!.stmt;
    const currentTable = currentStmt.expression;
    const last = currentTable.last;
    if (last instanceof Ast.SliceExpression && last.limit.toJS() !== 1)
        return null;

    const topResult = results[0];
    const id = topResult.value.id;

    if (!id || !id.equals(name))
        return null;

    return { topResult, ctx, info: null, action: ctx.nextInfo && ctx.nextInfo.isAction ? C.getInvocation(ctx.next!) : null };
}

function makeThingpediaRecommendation(ctx : ContextInfo, info : SlotBag) {
    const results = ctx.results;
    assert(results && results.length > 0);
    const currentStmt = ctx.current!.stmt;
    const currentTable = currentStmt.expression;
    const last = currentTable.last;
    if (last instanceof Ast.SliceExpression && last.limit.toJS() !== 1)
        return null;

    const topResult = results[0];
    if (!isInfoPhraseCompatibleWithResult(topResult, info))
        return null;

    return { topResult, ctx, info, action: ctx.nextInfo && ctx.nextInfo.isAction ? C.getInvocation(ctx.next!) : null };
}


function checkRecommendation({ topResult, action: nextAction } : Recommendation, info : SlotBag) {
    assert(info instanceof SlotBag);
    if (!topResult.value.id)
        return null;

    const resultType = topResult.value.id.getType();
    const idType = info.schema!.getArgType('id')!;
    if (!idType || !idType.equals(resultType))
        return null;

    if (!isInfoPhraseCompatibleWithResult(topResult, info))
        return null;

    return { topResult, info, action: nextAction };
}

function checkActionForRecommendation({ topResult, info, action: nextAction } : Recommendation, action : Ast.Invocation) {
    if (!topResult.value.id)
        return null;
    const resultType = topResult.value.id.getType();

    if (nextAction !== null) {
        if (!C.isSameFunction(nextAction.schema!, action.schema!))
            return null;
    }

    if (!C.hasArgumentOfType(action, resultType))
        return null;

    return { topResult, info, action };
}

// make a recommendation that looks like an answer, that is, "so and so is a ..."
function makeAnswerStyleRecommendation({ topResult, ctx, action } : Recommendation, filter : C.FilterSlot) {
    if (!ctx)
        return null;
    let info : SlotBag|null = new SlotBag(ctx.currentFunction);
    info = checkAndAddSlot(info, filter);
    if (info === null)
        return null;
    info = checkInfoPhrase(ctx, info);
    if (info === null)
        return null;

    return checkRecommendation({ topResult, action, info: null }, info);
}


function makeDisplayResult(ctx : ContextInfo, info : SlotBag) {
    const results = ctx.results;
    assert(results && results.length > 0);
    const topResult = results[0];

    if (ctx.currentFunction!.is_list)
        return null;
    if (!C.isSameFunction(ctx.currentFunction!, info.schema!))
        return null;
    if (!isInfoPhraseCompatibleWithResult(topResult, info))
        return null;
    const newInfo = checkInfoPhrase(ctx, info);
    if (newInfo === null)
        return null;

    return { topResult, ctx, info: newInfo, action: ctx.nextInfo && ctx.nextInfo.isAction ? C.getInvocation(ctx.next!) : null, hasAnythingElse: false };
}

function combineDisplayResult(proposal : Recommendation, newInfo : SlotBag) {
    const { ctx, info:oldInfo } = proposal;
    if (!ctx)
        return null;
    const results = ctx.results;
    assert(results && results.length > 0);
    const topResult = results[0];
    assert(isInfoPhraseCompatibleWithResult(topResult, newInfo));

    const maybeNewInfo = oldInfo ? SlotBag.merge(oldInfo, newInfo) : newInfo;
    if (maybeNewInfo === null)
        return null;

    const newProposal : Recommendation = {
        ctx: proposal.ctx,
        topResult: proposal.topResult,
        hasAnythingElse: proposal.hasAnythingElse,
        action: proposal.action,
        info: maybeNewInfo,
    };
    return newProposal;
}

function makeRecommendationReply(ctx : ContextInfo, proposal : Recommendation) {
    const { topResult, action, hasLearnMore } = proposal;
    const options : AgentReplyOptions = {
        numResults: 1
    };
    if (action || hasLearnMore)
        options.end = false;
    if (action === null) {
        return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_recommend_one', null), proposal, null, options);
    } else {
        const chainParam = findChainParam(topResult, action);
        if (!chainParam)
            return null;
        return makeAgentReply(ctx, addActionParam(ctx, 'sys_recommend_one', action, chainParam, topResult.value.id, 'proposed'),
            proposal, null, options);
    }
}

function makeDisplayResultReply(ctx : ContextInfo, proposal : Recommendation) {
    const { action, hasAnythingElse } = proposal;
    const options : AgentReplyOptions = {
        numResults: 1
    };
    if (action || hasAnythingElse)
        options.end = false;
    return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_display_result', null), proposal, null, options);
}

function negativeRecommendationReply(ctx : ContextInfo, [preamble, request] : [Ast.Expression|null, Ast.Expression|null]) {
    if (!((preamble === null || preamble instanceof Ast.FilterExpression) &&
          (request === null || request instanceof Ast.FilterExpression)))
        return null;

    const proposal = ctx.aux;
    const { topResult, info, } = proposal;
    const proposalType = topResult.value.id ? topResult.value.id.getType() : null;
    request = combinePreambleAndRequest(preamble, request, info, proposalType);
    if (request === null)
        return null;
    return proposalReply(ctx, request, refineFilterToAnswerQuestionOrChangeFilter);
}

function positiveRecommendationReply(ctx : ContextInfo, acceptedAction : Ast.Invocation|null, name : Ast.Value|null) {
    const proposal = ctx.aux as Recommendation;
    const { topResult, action: actionProposal } = proposal;

    // FIXME this should be allowed when we can parameter-pass by non-ID
    if (!topResult.value.id)
        return null;

    if (acceptedAction === null) {
        // if the user did not give an action earlier, and no action
        // was proposed by the agent right now, the flow is roughly
        //
        // U: hello i am looking for a restaurant
        // A: how about the ... ?
        // U: sure I like that
        //
        // this doesn't make much sense, so we don't want this flow
        if (actionProposal === null)
            return null;

        acceptedAction = actionProposal;
    }
    assert(acceptedAction);

    if (actionProposal !== null && !C.isSameFunction(actionProposal.schema!, acceptedAction.schema!))
        return null;
    if (name !== null && !topResult.value.id.equals(name))
        return null;

    // do not consider a phrase of the form "play X" to be "accepting the action by name"
    // if the action auto-confirms, because the user is likely playing something else
    if (name) {
        const confirm = C.normalizeConfirmAnnotation(acceptedAction.schema as Ast.FunctionDef);
        if (confirm === 'auto')
            return null;
    }

    const chainParam = findChainParam(topResult, acceptedAction);
    if (!chainParam)
        return null;
    return addActionParam(ctx, 'execute', acceptedAction!, chainParam, topResult.value.id, 'accepted');
}

function recommendationCancelReply(ctx : ContextInfo, valid : boolean) {
    // see dialogue.genie for the meaning of this boolean
    if (!valid)
        return null;

    // "thank you" closes the dialogue
    // we cannot close the dialogue if we have pending actions
    if (ctx.next)
        return null;
    return makeSimpleState(ctx, 'cancel', null);
}

function recommendationLearnMoreReply(ctx : ContextInfo, name : Ast.Value|null) {
    const proposal = ctx.aux as Recommendation;
    const { topResult, } = proposal;
    if (name !== null && (!topResult.value.id || !topResult.value.id.equals(name)))
        return null;
    return makeSimpleState(ctx, 'learn_more', null);
}

function repeatCommandReply(ctx : ContextInfo) {
    if (ctx.next)
        return null;
    if (ctx.currentFunction!.is_monitorable)
        return null;

    const clone = ctx.current!.clone();
    clone.results = null;
    clone.confirm = 'accepted';
    return addNewItem(ctx, 'execute', null, 'accepted', clone);
}

export {
    makeActionRecommendation,
    makeArgMinMaxRecommendation,
    makeRecommendation,
    makeThingpediaRecommendation,
    makeAnswerStyleRecommendation,
    checkRecommendation,
    checkActionForRecommendation,
    makeDisplayResult,
    combineDisplayResult,
    makeRecommendationReply,
    makeDisplayResultReply,

    positiveRecommendationReply,
    negativeRecommendationReply,
    recommendationCancelReply,
    recommendationLearnMoreReply,
    repeatCommandReply,
};
