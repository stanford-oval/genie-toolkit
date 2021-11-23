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

import * as SentenceGeneratorTypes from '../sentence-generator/types';
import { setOrAddInvocationParam, StateM } from '../utils/thingtalk';

import * as C from '../templates/ast_manip';
import ThingpediaLoader from '../templates/load-thingpedia';

import { ContextInfo, ResultInfo } from './context-info';
import { ContextPhraseCreator, makeContextPhrase } from './context-phrases';
import { POLICY_NAME } from './metadata';

// NOTE: this version of arraySubset uses ===
// the one in array_utils uses .equals()
// this one is called on array of strings, so === is appropriate
function arraySubset<T>(small : T[], big : T[]) : boolean {
    for (const element of small) {
        let good = false;
        for (const candidate of big) {
            if (candidate === element) {
                good = true;
                break;
            }
        }
        if (!good)
            return false;
    }
    return true;
}

// Helper classes for info that we extract from the current context
// These exist to minimize AST traversals during expansion

// NOTE: while ast_manip is mostly just about ThingTalk semantics, with
// a few heuristics sprinkled out, this is really only about the "transaction"
// dialogue policy
// hence we hard-code the policy name here, and check it before doing anything
// in the templates
// templates can be combined though

export function isUserAskingResultQuestion(ctx : ContextInfo) : boolean {
    // is the user asking a question about the result (or a specific element), or refining a search?
    // we say it's a question if any of the following is true:
    // - it's a computation question
    // - there is an id filter
    // - it's a projection question and the projection was different at the previous turn
    // we also treat it as a question for all compute questions because that simplifies
    // writing the templates

    if (ctx.state.dialogueAct === 'action_question')
        return true;
    if (ctx.currentIdx === null)
        return false;

    const currentStmt = ctx.current!.stmt;
    const currentTable = currentStmt.lastQuery;
    if (!currentTable)
        return false;
    if (currentTable instanceof Ast.ProjectionExpression && currentTable.computations.length > 0)
        return true;

    const filterTable = C.findFilterExpression(currentStmt.expression);
    if (filterTable && C.filterUsesParam(filterTable.filter, 'id'))
        return true;

    if (ctx.currentIdx === 0)
        return false;

    const currentProjection = ctx.resultInfo!.projection;
    if (!currentProjection)
        return false;

    const previous = ctx.state.history[ctx.currentIdx - 1];
    // only complete (executed) programs make it to the history, so this must be true
    assert(previous.results !== null);
    const previousResultInfo = new ResultInfo(ctx.state, previous);
    if (!previousResultInfo.projection)
        return true;

    // it's a question if the current projection is not a subset of the previous one
    // (for a search refinement: it might be exactly the same as before, or we might have
    // lost some parameters because we put a filter on it)
    return !arraySubset(currentProjection, previousResultInfo.projection);
}

/**
 * @deprecated
 */
function addActionParam(ctx : ContextInfo,
                        dialogueAct : string,
                        action : Ast.Invocation,
                        pname : string,
                        value : Ast.Value,
                        confirm : 'accepted' | 'proposed') : Ast.DialogueState {
    assert(action instanceof Ast.Invocation);
    assert(['accepted', 'confirmed', 'proposed'].indexOf(confirm) >= 0);

    let newHistoryItem;
    if (ctx.nextInfo) {
        const next = ctx.next;
        assert(next);
        const nextInvocation = C.getInvocation(next);
        const isSameFunction = C.isSameFunction(nextInvocation.schema!, action.schema!);

        if (isSameFunction) {
            // we want to modify the existing action in case:
            // - case 1: we're currently accepting/confirming the action (perhaps with the same or
            //   a different parameter)
            // - case 2: we're proposing the same action that was proposed before
            //
            // to carry over parameters, we actually clone the statement and set the parameter
            // if confirm == "proposed":
            //   makeTargetState() will add at the end, after the currently accepted
            //   item, and we'll have two actions (one "accepted" and one "proposed"), or just one "proposed" action
            // if confirm == "accepted":
            //   makeTargetState() will wipe everything and we'll only one

            newHistoryItem = next.clone();
            const newInvocation = C.getInvocation(newHistoryItem);
            assert(newInvocation instanceof Ast.Invocation);
            setOrAddInvocationParam(newInvocation, pname, value);
            // also add the new parameters from this action, if any
            for (const param of action.in_params) {
                if (param.value.isUndefined)
                    continue;
                setOrAddInvocationParam(newInvocation, param.name, param.value);
            }

            newHistoryItem.confirm = confirm;
        }
    }

    if (!newHistoryItem) {
        const in_params = [new Ast.InputParam(null, pname, value)];
        const setparams = new Set;
        setparams.add(pname);
        for (const param of action.in_params) {
            if (param.value.isUndefined)
                continue;
            if (param.name !== pname)
                in_params.push(param.clone());
            setparams.add(param.name);
        }
        const schema = action.schema!;

        // make sure we add all $undefined values, otherwise we'll fail
        // to recognize that the statement is not yet executable, and we'll
        // crash in the compiler
        for (const arg of schema.iterateArguments()) {
            if (arg.is_input && arg.required && !setparams.has(arg.name))
                in_params.push(new Ast.InputParam(null, arg.name, new Ast.Value.Undefined(true)));
        }

        const newInvocation = new Ast.Invocation(null,
            action.selector,
            action.channel,
            in_params,
            schema
        );
        const newStmt = new Ast.ExpressionStatement(null,
            new Ast.InvocationExpression(null, newInvocation, schema));
        newHistoryItem = new Ast.DialogueHistoryItem(null, newStmt, null, confirm);
    }

    return StateM.makeTargetState(ctx.state, POLICY_NAME, dialogueAct, [], confirm, newHistoryItem);
}

/**
 * @deprecated
 */
function addAction(ctx : ContextInfo,
                   dialogueAct : string,
                   action : Ast.Invocation,
                   confirm : 'accepted' | 'proposed') : Ast.DialogueState {
    assert(action instanceof Ast.Invocation);
    // note: parameters from the action are ignored altogether!

    let newHistoryItem;
    if (ctx.nextInfo) {
        const next = ctx.next;
        assert(next);

        const nextInvocation = C.getInvocation(next);
        if (C.isSameFunction(nextInvocation.schema!, action.schema!)) {
            assert(next.results === null);
            // case 1:
            // - we trying to propose an action that the user has already introduced
            // earlier
            // in that case, we want to remember the action as accepted, not proposed
            // case 2:
            // - we trying to accept or confirm the action that was previously proposed
            // in that case, we want to change the action to accepted or confirmed
            if (confirm === 'proposed' || confirm === next.confirm)
                return StateM.makeSimpleState(ctx.state, POLICY_NAME, dialogueAct, []);

            newHistoryItem = new Ast.DialogueHistoryItem(null, next.stmt, null, confirm);
        }
    }

    if (!newHistoryItem) {
        const newInvocation = new Ast.Invocation(null,
            action.selector,
            action.channel,
            [],
            action.schema
        );
        const newStmt = new Ast.ExpressionStatement(null, new Ast.InvocationExpression(null,
            newInvocation, action.schema
        ));
        newHistoryItem = new Ast.DialogueHistoryItem(null, newStmt, null, confirm);
    }

    return StateM.makeTargetState(ctx.state, POLICY_NAME, dialogueAct, [], confirm, newHistoryItem);
}

/**
 * @deprecated
 */
function addQuery(ctx : ContextInfo,
                  dialogueAct : string,
                  newTable : Ast.Expression,
                  confirm : 'accepted' | 'proposed') : Ast.DialogueState {
    newTable = C.adjustDefaultParameters(newTable);
    const newStmt = new Ast.ExpressionStatement(null, newTable);
    const newHistoryItem = new Ast.DialogueHistoryItem(null, newStmt, null, confirm);

    return StateM.makeTargetState(ctx.state, POLICY_NAME, dialogueAct, [], confirm === 'accepted' ? 'accepted-query' : 'proposed-query', newHistoryItem);
}

/**
 * @deprecated
 */
function addQueryAndAction(ctx : ContextInfo,
                           dialogueAct : string,
                           newTable : Ast.Expression,
                           newAction : Ast.Invocation,
                           confirm : 'accepted' | 'proposed') : Ast.DialogueState {
    const newTableStmt = new Ast.ExpressionStatement(null, newTable);
    const newTableHistoryItem = new Ast.DialogueHistoryItem(null, newTableStmt, null, confirm);

    // add the new table history item right after the current one, and replace everything after that

    const newActionStmt = new Ast.ExpressionStatement(null, new Ast.InvocationExpression(null, newAction, newAction.schema));
    const newActionHistoryItem = new Ast.DialogueHistoryItem(null, newActionStmt, null, confirm);

    return StateM.makeTargetState(ctx.state, POLICY_NAME, dialogueAct, [], confirm, newTableHistoryItem, newActionHistoryItem);
}

/**
 * @deprecated
 */
function setEndBit(reply : SentenceGeneratorTypes.AgentReplyRecord, value : boolean) : SentenceGeneratorTypes.AgentReplyRecord {
    const newReply = {} as SentenceGeneratorTypes.AgentReplyRecord;
    Object.assign(newReply, reply);
    // TODO
    // newReply.end = value;
    return newReply;
}

function ctxCanHaveRelatedQuestion(ctx : ContextInfo) : boolean {
    const currentStmt = ctx.current!.stmt;
    if (currentStmt.stream !== null)
        return false;
    const currentTable = currentStmt.lastQuery;
    if (!currentTable)
        return false;
    if (!(currentTable.schema instanceof Ast.FunctionDef)) // FIXME ExpressionSignature that is not a FunctionDef - not sure how it happens...
        return false;
    const related = currentTable.schema.getAnnotation<string[]>('related');
    return !!(related && related.length);
}

export function getUserContextPhrases(ctx : ContextInfo, contextTable : SentenceGeneratorTypes.ContextTable) : SentenceGeneratorTypes.ContextPhrase[] {
    const phrases : SentenceGeneratorTypes.ContextPhrase[] = [];

    getContextPhrasesCommon(ctx, contextTable, phrases);
    return phrases;
}

export function getAgentContextPhrases(ctx : ContextInfo,
                                       tpLoader : ThingpediaLoader,
                                       contextTable : SentenceGeneratorTypes.ContextTable) : SentenceGeneratorTypes.ContextPhrase[] {
    const creator = new ContextPhraseCreator(ctx, tpLoader, contextTable);
    const phrases = creator.make();

    getContextPhrasesCommon(ctx, contextTable, phrases);
    return phrases;
}

function getContextPhrasesCommon(ctx : ContextInfo, contextTable : SentenceGeneratorTypes.ContextTable, phrases : SentenceGeneratorTypes.ContextPhrase[]) {
    if (ctx.state.dialogueAct === 'notification')
        phrases.push(makeContextPhrase(contextTable.ctx_with_notification, ctx));

    if (ctx.state.dialogueAct === 'init')
        phrases.push(makeContextPhrase(contextTable.ctx_init, ctx));

    if (ctx.isMultiDomain)
        phrases.push(makeContextPhrase(contextTable.ctx_multidomain, ctx));

    if (ctx.nextInfo !== null) {
        phrases.push(makeContextPhrase(contextTable.ctx_with_action, ctx));

        if (!ctx.nextInfo.isComplete)
            phrases.push(makeContextPhrase(contextTable.ctx_incomplete_action, ctx));
    } else {
        if (ctx.resultInfo && ctx.resultInfo.isTable)
            phrases.push(makeContextPhrase(contextTable.ctx_without_action, ctx));
    }
    if (!ctx.resultInfo)
        return;
    if (ctx.resultInfo.hasError) {
        phrases.push(makeContextPhrase(contextTable.ctx_with_error, ctx));
        return;
    }
    if (ctx.resultInfo.hasEmptyResult)
        return;
    if (ctx.resultInfo.hasStream && ctx.state.dialogueAct !== 'notification')
        return;

    assert(ctx.results && ctx.results.length > 0);
    phrases.push(makeContextPhrase(contextTable.ctx_with_result, ctx));
    if (ctx.resultInfo.isTable && !ctx.resultInfo.isAggregation)
        phrases.push(makeContextPhrase(contextTable.ctx_with_table_result, ctx));
    if (ctx.resultInfo.isAggregation)
        phrases.push(makeContextPhrase(contextTable.ctx_with_aggregation_result, ctx));

    if (ctxCanHaveRelatedQuestion(ctx))
        phrases.push(makeContextPhrase(contextTable.ctx_for_related_question, ctx));
    if (isUserAskingResultQuestion(ctx)) {
        phrases.push(makeContextPhrase(contextTable.ctx_with_result_question, ctx));
    } else {
        if (ctx.resultInfo.argMinMaxField)
            phrases.push(makeContextPhrase(contextTable.ctx_with_result_argminmax, ctx));
        phrases.push(makeContextPhrase(contextTable.ctx_with_result_noquestion, ctx));
        if (ctx.nextInfo)
            phrases.push(makeContextPhrase(contextTable.ctx_with_result_and_action, ctx));

        if (ctx.resultInfo.projection === null)
            phrases.push(makeContextPhrase(contextTable.ctx_without_projection, ctx));
    }
}

export {
    setEndBit,

    // manipulate states to create new states
    addActionParam,
    addAction,
    addQuery,
    addQueryAndAction,
};
