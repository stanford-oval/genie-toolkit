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

import { SlotBag } from '../slot_bag';
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
        action: ctx.nextInfo && ctx.nextInfo.isAction ? checkInvocationCast(C.getInvocation(ctx.next!)) : null,
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
        action: ctx.nextInfo && ctx.nextInfo.isAction ? checkInvocationCast(C.getInvocation(ctx.next!)) : null,
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
        action: ctx.nextInfo && ctx.nextInfo.isAction ? checkInvocationCast(C.getInvocation(ctx.next!)) : null,
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

export function makeDisplayResultReplyFromList(ctx : ContextInfo, proposal : ListProposal) {
    const { results, action, hasLearnMore } = proposal;
    const options : AgentReplyOptions = {
        numResults: results.length
    };
    if (action || hasLearnMore)
        options.end = false;
    return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_display_result', null), proposal, null, options);
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
    makeArgMinMaxRecommendation,
    makeRecommendation,
    makeThingpediaRecommendation,
    checkRecommendation,
    makeDisplayResult,
    combineDisplayResult,
    checkDisplayResult,
    makeRecommendationReply,
    makeDisplayResultReply,

    repeatCommandReply,
};
