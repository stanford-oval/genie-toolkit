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

import { Ast } from 'thingtalk';

import * as ThingTalkUtils from '../../utils/thingtalk';

import * as C from '../ast_manip';
import ThingpediaLoader from '../load-thingpedia';

import { SlotBag } from '../slot_bag';
import {
    AgentReplyOptions,
    ContextInfo,
    makeAgentReply,
    makeSimpleState,
    addNewItem,
    propagateDeviceIDsLevenshtein,
    setOrAddInvocationParam,
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
import type { ListProposal } from './list-proposal';

export interface Recommendation {
    ctx : ContextInfo;
    topResult : Ast.DialogueHistoryResultItem;
    info : SlotBag|null;
    action : Ast.Invocation|null;
    hasLearnMore : boolean;
    hasAnythingElse : boolean;
}

export function recommendationKeyFn(rec : Recommendation) {
    return {
        functionName: rec.ctx.currentFunction!.qualifiedName
    };
}

function checkInvocationCast(x : Ast.Invocation|Ast.FunctionCallExpression) : Ast.Invocation {
    assert(x instanceof Ast.Invocation);
    return x;
}

function makeActionRecommendation(ctx : ContextInfo, action : Ast.Invocation) : Recommendation|null {
    // we don't offer actions during recommendations
    if (ctx.state.dialogueAct === 'notification')
        return null;
    assert(action instanceof Ast.Invocation);

    const results = ctx.results;
    assert(results && results.length > 0);
    const currentStmt = ctx.current!.stmt;
    const currentTable = currentStmt.expression;
    const last = currentTable.last;
    if ((last instanceof Ast.SliceExpression ||
        (last instanceof Ast.ProjectionExpression && last.expression instanceof Ast.SliceExpression))
        && results.length !== 1)
        return null;

    const topResult = results[0];
    const id = topResult.value.id;
    if (!id)
        return null;

    if (action.in_params.length !== 1)
        return null;

    for (const param of action.in_params) {
        if (param.value.equals(id))
            return { ctx, topResult, info: null, action, hasLearnMore: false, hasAnythingElse: false };
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

function makeRecommendation(ctx : ContextInfo, name : Ast.Value) : Recommendation|null {
    const results = ctx.results;
    assert(results && results.length > 0);
    const currentStmt = ctx.current!.stmt;
    const currentTable = currentStmt.expression;
    const last = currentTable.last;
    if ((last instanceof Ast.SliceExpression ||
        (last instanceof Ast.ProjectionExpression && last.expression instanceof Ast.SliceExpression))
        && results.length !== 1)
        return null;

    const topResult = results[0];
    const id = topResult.value.id;

    if (!id || !id.equals(name))
        return null;

    return {
        ctx, topResult,
        info: null,
        action: ctx.nextInfo && ctx.nextInfo.isAction ? checkInvocationCast(C.getInvocation(ctx.next!.stmt)) : null,
        hasLearnMore: false,
        hasAnythingElse: false
    };
}

function makeThingpediaRecommendation(ctx : ContextInfo, info : SlotBag) : Recommendation|null {
    const results = ctx.results;
    assert(results && results.length > 0);
    const currentStmt = ctx.current!.stmt;
    const currentTable = currentStmt.expression;
    const last = currentTable.last;
    if ((last instanceof Ast.SliceExpression ||
        (last instanceof Ast.ProjectionExpression && last.expression instanceof Ast.SliceExpression))
        && results.length !== 1)
        return null;

    const topResult = results[0];
    if (!isInfoPhraseCompatibleWithResult(topResult, info))
        return null;

    return {
        ctx, topResult,
        info,
        action: ctx.nextInfo && ctx.nextInfo.isAction ? checkInvocationCast(C.getInvocation(ctx.next!.stmt)) : null,
        hasLearnMore: false,
        hasAnythingElse: false
    };
}

function checkRecommendation(rec : Recommendation, info : SlotBag|null) : Recommendation|null {
    if (info && !isInfoPhraseCompatibleWithResult(rec.topResult, info))
        return null;

    const resultInfo = rec.ctx.resultInfo!;
    if (resultInfo.projection !== null) {
        // check that all projected names are present
        for (const name of resultInfo.projection) {
            if (!((info && info.has(name)) || (rec.info && rec.info.has(name))))
                return null;
        }
    }

    const merged = info && rec.info ? SlotBag.merge(info, rec.info) : (info || rec.info);
    if (info && rec.info && !merged)
        return null;

    return {
        ctx: rec.ctx, topResult: rec.topResult,
        info: merged,
        action: rec.action,
        hasLearnMore: rec.hasLearnMore,
        hasAnythingElse: rec.hasAnythingElse
    };
}

function checkActionForRecommendation(rec : Recommendation, action : Ast.Invocation) {
    // we don't offer actions during recommendations
    if (rec.ctx.state.dialogueAct === 'notification')
        return null;
    if (!rec.topResult.value.id)
        return null;
    const resultType = rec.topResult.value.id.getType();

    if (rec.action !== null) {
        if (!C.isSameFunction(rec.action.schema!, action.schema!))
            return null;
    }

    if (!C.hasArgumentOfType(action, resultType))
        return null;

    return {
        ctx: rec.ctx, topResult: rec.topResult,
        info: rec.info,
        action,
        hasLearnMore: rec.hasLearnMore,
        hasAnythingElse: rec.hasAnythingElse
    };
}

export function recommendationSetLearnMore(rec : Recommendation) {
    return {
        ctx: rec.ctx, topResult: rec.topResult,
        info: rec.info,
        // reset the action to null if the agent explicitly asks to "learn more"
        action: null,
        hasLearnMore: true,
        hasAnythingElse: rec.hasAnythingElse
    };
}

function makeDisplayResult(ctx : ContextInfo, info : SlotBag)  : Recommendation|null {
    const results = ctx.results;
    assert(results && results.length > 0);
    const topResult = results[0];

    if (ctx.currentFunction!.is_list)
        return null;
    if (!C.isSameFunction(ctx.currentFunction!, info.schema!))
        return null;
    if (!isInfoPhraseCompatibleWithResult(topResult, info))
        return null;
    return {
        ctx, topResult,
        info,
        action: ctx.nextInfo && ctx.nextInfo.isAction ? checkInvocationCast(C.getInvocation(ctx.next!.stmt)) : null,
        hasLearnMore: false,
        hasAnythingElse: false
    };
}

function combineDisplayResult(proposal : Recommendation, newInfo : SlotBag) {
    const { ctx, info:oldInfo } = proposal;
    if (!ctx)
        return null;
    const results = ctx.results;
    assert(results && results.length > 0);
    const topResult = results[0];

    // this can occur if there is more than one result for a single result query,
    // which can occur for IoT queries over multiple devices
    if (!isInfoPhraseCompatibleWithResult(topResult, newInfo))
        return null;

    const maybeNewInfo = oldInfo ? SlotBag.merge(oldInfo, newInfo) : newInfo;
    if (maybeNewInfo === null)
        return null;

    const newProposal : Recommendation = {
        ctx: proposal.ctx,
        topResult: proposal.topResult,
        info: maybeNewInfo,
        action: proposal.action,
        hasLearnMore: false,
        hasAnythingElse: proposal.hasAnythingElse,
    };
    return newProposal;
}

function checkDisplayResult(proposal : Recommendation|null) {
    if (!proposal)
        return null;

    const resultInfo = proposal.ctx.resultInfo!;
    if (resultInfo.projection !== null) {
        // check that all projected names are present
        for (const name of resultInfo.projection) {
            if (!proposal.info || !proposal.info.has(name))
                return null;
        }
    }

    return proposal;
}

function makeRecommendationReply(ctx : ContextInfo, proposal : Recommendation) {
    const options : AgentReplyOptions = {
        numResults: 1
    };
    // we neglect all the recommend actions for now. This is giving us strange results
    // TODO: clean this up
    return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_recommend_one', null), proposal, null, options);
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

export function makeDisplayResultReplyFromList(ctx : ContextInfo, proposal : ListProposal) {
    const { results, action, hasLearnMore } = proposal;
    const options : AgentReplyOptions = {
        numResults: results.length
    };
    if (action || hasLearnMore)
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
    return proposalReply(ctx, request, refineFilterToAnswerQuestionOrChangeFilter, "negativeRecommendationReply_multiwoz.txt");
}

function positiveRecommendationReply(loader : ThingpediaLoader,
                                     ctx : ContextInfo,
                                     acceptedAction : Ast.Invocation|null,
                                     name : Ast.Value|null) {
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
        const confirm = ThingTalkUtils.normalizeConfirmAnnotation(acceptedAction.schema as Ast.FunctionDef);
        if (confirm === 'auto')
            return null;
    }

    const chainParam = findChainParam(topResult, acceptedAction);
    if (!chainParam)
        return null;
    
    // Levenshtein: adding an invocation with undefined fields set
    const invocation : Ast.Invocation = acceptedAction!.clone();
    C.addInvocationInputParamLevenshtein(invocation, new Ast.InputParam(null, chainParam, topResult.value.id));
    for (const arg of invocation.schema!.iterateArguments()) {
        if (arg.is_input && arg.required && !invocation.in_params.map((i) => i.name).includes(arg.name))
            invocation.in_params.push(new Ast.InputParam(null, arg.name, new Ast.Value.Undefined(true)));
    }

    let applyres : Ast.ChainExpression;
    let oldExpr  : Ast.ChainExpression | undefined;
    const delta  : Ast.Levenshtein = (new Ast.Levenshtein(invocation.location, new Ast.InvocationExpression(invocation.location, invocation, invocation.schema), "$continue")).optimize();
    if (ctx.nextInfo) {
        oldExpr = ctx.next!.stmt.expression;
        applyres = Ast.applyLevenshteinSync(oldExpr, delta);
    } else {
        setOrAddInvocationParam(invocation, chainParam, topResult.value.id);
        applyres = C.toChainExpression(new Ast.InvocationExpression(invocation.location, invocation, invocation.schema));
        applyres = propagateDeviceIDsLevenshtein(ctx, applyres) as Ast.ChainExpression;
    }
    // const res = addActionParam(ctx, 'execute', acceptedAction!, chainParam, topResult.value.id, 'accepted', delta);
    // C.levenshteinDebugOutput(applyres, res.history[res.history.length - 1].stmt.expression, "positiveRecommendationReply_action_multiwoz.txt", [delta], oldExpr);
    // return res;
    const newHistoryItem = new Ast.DialogueHistoryItem(null, new Ast.ExpressionStatement(null, applyres), null, 'accepted', delta);
    return addNewItem(ctx, 'execute', null, 'accepted', newHistoryItem);

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
    const current = ctx.current!;
    if (!current.results!.error && ctx.currentFunction!.is_monitorable)
        return null;

    const clone = current.clone();
    clone.results = null;
    clone.confirm = 'accepted';
    return addNewItem(ctx, 'execute', null, 'accepted', clone);
}

export {
    makeActionRecommendation,
    makeArgMinMaxRecommendation,
    makeRecommendation,
    makeThingpediaRecommendation,
    checkRecommendation,
    checkActionForRecommendation,
    makeDisplayResult,
    combineDisplayResult,
    checkDisplayResult,
    makeRecommendationReply,
    makeDisplayResultReply,

    positiveRecommendationReply,
    negativeRecommendationReply,
    recommendationCancelReply,
    recommendationLearnMoreReply,
    repeatCommandReply,
};
