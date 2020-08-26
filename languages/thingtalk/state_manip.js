// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
"use strict";

const assert = require('assert');
const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const C = require('./ast_manip');
const { isExecutable } = require('./utils');

// NOTE: this version of arraySubset uses ===
// the one in array_utils uses .equals()
// this one is called on array of strings, so === is appropriate
function arraySubset(small, big) {
    for (let element of small) {
        let good = false;
        for (let candidate of big) {
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

const POLICY_NAME = 'org.thingpedia.dialogue.transaction';

const INITIAL_CONTEXT_INFO = {};

const LARGE_RESULT_THRESHOLD = 10;
function isLargeResultSet(result) {
    return result.more || result.count.isVarRef || result.count.value >= LARGE_RESULT_THRESHOLD;
}

function getTableArgMinMax(table) {
    while (table.isProjection || table.isCompute)
        table = table.table;

    if (table.isIndex && table.table.isSort && table.indices.length === 1 && table.indices[0].isNumber &&
        table.indices[0].value === 1)
        return [table.table.field, table.table.direction];

    return null;
}

class ResultInfo {
    constructor(state, item) {
        assert(item.results !== null);
        this.isTable = !!(item.stmt.table && item.stmt.actions.every((a) => a.isNotify));

        if (this.isTable) {
            const table = item.stmt.table;
            // if there is a compute at top-level, there is a projection too
            assert(!table.isCompute);
            this.isQuestion = !!(table.isProjection || table.isCompute || table.isIndex || table.isAggregation);
            this.isAggregation = !!table.isAggregation;
            this.isList = table.schema.is_list;
            this.argMinMaxField = getTableArgMinMax(table);
            assert(this.argMinMaxField === null || this.isQuestion);
            this.projection = table.isProjection ? table.args.slice() : null;
            if (this.projection)
                this.projection.sort();
        } else {
            this.isQuestion = false;
            this.isAggregation = false;
            this.argMinMaxField = null;
            this.projection = null;
            if (state.dialogueAct === 'action_question')
                this.projection = state.dialogueActParam;
        }
        this.hasError = item.results.error !== null;
        this.hasEmptyResult = item.results.results.length === 0;
        this.hasSingleResult = item.results.results.length === 1;
        this.hasLargeResult = isLargeResultSet(item.results);
        this.hasID = item.results.results.length > 0 &&
            !!item.results.results[0].value.id;
    }
}

class NextStatementInfo {
    constructor(currentItem, resultInfo, nextItem) {
        this.isAction = !nextItem.stmt.table;

        this.chainParameter = null;
        this.chainParameterFilled = false;
        this.isComplete = isExecutable(nextItem.stmt);

        if (!this.isAction)
            return;

        assert(nextItem.stmt.actions.length === 1);
        const action = nextItem.stmt.actions[0];
        assert(action.isInvocation);

        if (!currentItem || !resultInfo || !resultInfo.isTable)
            return;
        const tableschema = currentItem.stmt.table.schema;
        const idType = tableschema.getArgType('id');
        if (!idType)
            return;

        const invocation = action.invocation;
        const actionschema = invocation.schema;
        for (let arg of actionschema.iterateArguments()) {
            if (!arg.is_input)
                continue;
            if (arg.type.equals(idType)) {
                this.chainParameter = arg.name;
                break;
            }
        }

        if (this.chainParameter === null)
            return;

        for (let in_param of invocation.in_params) {
            if (in_param.name === this.chainParameter && !in_param.value.isUndefined) {
                this.chainParameterFilled = true;
                break;
            }
        }
    }
}

class ContextInfo {
    constructor(state, currentFunctionSchema, resultInfo, previousDomainIdx, currentIdx,
        nextIdx, nextFunctionSchema, nextInfo, aux = null) {
        this.state = state;

        assert(currentFunctionSchema === null || currentFunctionSchema instanceof Ast.FunctionDef);
        if (currentFunctionSchema === null) {
            this.currentFunctionSchema = null;
            this.currentFunction = null;
        } else {
            this.currentFunctionSchema = currentFunctionSchema;
            this.currentFunction = currentFunctionSchema.class.name + ':' + currentFunctionSchema.name;
        }
        this.resultInfo = resultInfo;
        this.isMultiDomain = previousDomainIdx !== null;
        this.previousDomainIdx = previousDomainIdx;
        this.currentIdx = currentIdx;

        assert(nextFunctionSchema === null || nextFunctionSchema instanceof Ast.FunctionDef);
        if (nextFunctionSchema === null) {
            this.nextFunctionSchema = null;
            this.nextFunction = null;
        } else {
            this.nextFunctionSchema = nextFunctionSchema;
            this.nextFunction = nextFunctionSchema.class.name + ':' + nextFunctionSchema.name;
        }
        this.nextIdx = nextIdx;
        this.nextInfo = nextInfo;
        this.aux = aux;
    }

    toString() {
        return `ContextInfo(${this.state.prettyprint()})`;
    }

    get results() {
        if (this.currentIdx !== null)
            return this.state.history[this.currentIdx].results.results;
        return null;
    }

    get error() {
        if (this.currentIdx !== null)
            return this.state.history[this.currentIdx].results.error;
        return null;
    }

    get previousDomain() {
        return this.previousDomainIdx !== null ? this.state.history[this.previousDomainIdx] : null;
    }

    get current() {
        return this.currentIdx !== null ? this.state.history[this.currentIdx] : null;
    }

    get next() {
        return this.nextIdx !== null ? this.state.history[this.nextIdx] : null;
    }

    clone() {
        return new ContextInfo(this.state.clone(),
            this.currentFunctionSchema, this.resultInfo, this.previousDomainIdx, this.currentIdx,
            this.nextIdx, this.nextFunctionSchema, this.nextInfo,
            this.aux);
    }
}

function getContextInfo(state) {
    let nextItemIdx = null, nextInfo = null, currentFunction = null, nextFunction = null, currentDevice = null, currentResultInfo = null,
        previousDomainItemIdx = null, currentItemIdx = null;
    let proposedSkip = 0;
    for (let idx = 0; idx < state.history.length; idx ++) {
        const item = state.history[idx];
        const functions = C.getFunctions(item.stmt);
        const device = functions[functions.length-1].class.name;
        assert(typeof device === 'string');
        if (currentDevice && device !== currentDevice)
            previousDomainItemIdx = currentItemIdx;
        if (item.confirm === 'proposed') {
            proposedSkip ++;
            continue;
        }
        if (item.results === null) {
            nextItemIdx = idx;
            nextFunction = functions[functions.length-1];
            nextInfo = new NextStatementInfo(state.history[currentItemIdx], currentResultInfo, item);
            break;
        }

        // proposed items must come after the current item
        // (but they can come before or after the next item, depending on what we're proposing)
        assert(proposedSkip === 0);

        currentDevice = device;
        currentFunction = functions[functions.length-1];
        currentItemIdx = idx;
        currentResultInfo = new ResultInfo(state, item);
    }
    if (nextItemIdx !== null)
        assert(nextInfo);
    if (nextItemIdx !== null && currentItemIdx !== null)
        assert(nextItemIdx === currentItemIdx + 1 + proposedSkip);
    if (previousDomainItemIdx !== null)
        assert(currentItemIdx !== null && previousDomainItemIdx <= currentItemIdx);

    return new ContextInfo(state, currentFunction, currentResultInfo,
        previousDomainItemIdx, currentItemIdx, nextItemIdx, nextFunction, nextInfo);
}

function isUserAskingResultQuestion(ctx) {
    // is the user asking a question about the result (or a specific element), or refining a search?
    // we say it's a question if the user is asking a projection question, and it's not the first turn,
    // and the projection was different at the previous turn

    if (ctx.state.dialogueAct === 'action_question')
        return true;
    if (ctx.currentIdx === null)
        return false;
    if (ctx.currentIdx === 0) {
        if (!ctx.current.stmt.table)
            return false;
        const filterTable = C.findFilterTable(ctx.current.stmt.table);
        if (!filterTable)
            return false;
        return C.filterUsesParam(filterTable.filter, 'id');
    }

    let currentProjection = ctx.resultInfo.projection;
    if (!currentProjection)
        return false;

    let previous = ctx.state.history[ctx.currentIdx - 1];
    // only complete (executed) programs make it to the history, so this must be true
    assert(previous.results !== null);
    let previousResultInfo = new ResultInfo(ctx.state, previous);
    if (!previousResultInfo.projection)
        return true;

    // it's a question if the current projection is not a subset of the previous one
    // (for a search refinement: it might be exactly the same as before, or we might have
    // lost some parameters because we put a filter on it)
    return !arraySubset(currentProjection, previousResultInfo.projection);
}

function addNewItem(ctx, dialogueAct, dialogueActParam, confirm, ...newHistoryItem) {
    newHistoryItem = newHistoryItem.map(C.adjustDefaultParameters);

    const newState = new Ast.DialogueState(null, POLICY_NAME, dialogueAct, dialogueActParam, []);

    if (confirm === 'proposed') {
        // find the first item that was not confirmed or accepted, and replace everything after that

        for (let i = 0; i < ctx.state.history.length; i++) {
            if (ctx.state.history[i].confirm === 'proposed')
                break;
            newState.history.push(ctx.state.history[i]);
        }
        newState.history.push(...newHistoryItem);
    } else {
        // wipe everything from state after the current program
        // this will remove all previously accepted and/or proposed actions
        //
        // XXX is the right thing to do?
        if (ctx.currentIdx !== null) {
            for (let i = 0; i <= ctx.currentIdx; i++)
                newState.history.push(ctx.state.history[i]);
        }
        newState.history.push(...newHistoryItem);
    }

    return newState;
}

function makeSimpleState(ctx, dialogueAct, dialogueActParam) {
    // a "simple state" carries the current executed/confirmed/accepted items, but not the
    // proposed ones

    const newState = new Ast.DialogueState(null, POLICY_NAME, dialogueAct, dialogueActParam, []);
    if (ctx === INITIAL_CONTEXT_INFO)
        return newState;

    for (let i = 0; i < ctx.state.history.length; i++) {
        if (ctx.state.history[i].confirm === 'proposed')
            break;
        newState.history.push(ctx.state.history[i]);
    }

    return newState;
}

function sortByName(p1, p2) {
    if (p1.name < p2.name)
        return -1;
    if (p1.name > p2.name)
        return 1;
    return 0;
}

function setOrAddInvocationParam(newInvocation, pname, value) {
    let found = false;
    for (let in_param of newInvocation.in_params) {
        if (in_param.name === pname) {
            found = true;
            in_param.value = value;
            break;
        }
    }
    if (!found) {
        newInvocation.in_params.push(new Ast.InputParam(null, pname, value));
        newInvocation.in_params.sort(sortByName);
    }
}

function mergeParameters(toInvocation, fromInvocation) {
    for (let in_param of fromInvocation.in_params) {
        if (in_param.value.isUndefined)
            continue;
        setOrAddInvocationParam(toInvocation, in_param.name, in_param.value);
    }

    return toInvocation;
}

function addActionParam(ctx, dialogueAct, action, pname, value, confirm) {
    assert(action instanceof Ast.Invocation);
    assert(['accepted', 'confirmed', 'proposed'].indexOf(confirm) >= 0);

    let newHistoryItem;
    if (ctx.nextInfo) {
        const nextInvocation = C.getInvocation(ctx.next);
        const isSameFunction = C.isSameFunction(nextInvocation.schema, action.schema);

        if (isSameFunction) {
            // we want to modify the existing action in case:
            // - case 1: we're currently accepting/confirming the action (perhaps with the same or
            //   a different parameter)
            // - case 2: we're proposing the same action that was proposed before
            //
            // to carry over parameters, we actually clone the statement and set the parameter
            // if confirm == "proposed":
            //   addNewItem() will add at the end, after the currently accepted
            //   item, and we'll have two actions (one "accepted" and one "proposed"), or just one "proposed" action
            // if confirm == "accepted":
            //   addNewItem() will wipe everything and we'll only one

            newHistoryItem = ctx.next.clone();
            const newInvocation = C.getInvocation(newHistoryItem);
            setOrAddInvocationParam(newInvocation, pname, value);
            // also add the new parameters from this action, if any
            for (let param of action.in_params) {
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
        for (let param of action.in_params) {
            if (param.value.isUndefined)
                continue;
            if (param.name !== pname)
                in_params.push(param.clone());
            setparams.add(param.name);
        }

        // make sure we add all $undefined values, otherwise we'll fail
        // to recognize that the statement is not yet executable, and we'll
        // crash in the compiler
        for (let arg of action.schema.iterateArguments()) {
            if (arg.is_input && arg.required && !setparams.has(arg.name))
                in_params.push(new Ast.InputParam(null, arg.name, new Ast.Value.Undefined(true)));
        }

        let newStmt;
        let newInvocation = new Ast.Invocation(null,
            action.selector,
            action.channel,
            in_params,
            action.schema
        );
        if (action.schema.functionType === 'action') {
            newStmt = new Ast.Statement.Command(null, null, [new Ast.Action.Invocation(null,
                newInvocation, action.schema.removeArgument(pname)
            )]);
        } else {
            newStmt = new Ast.Statement.Command(null, new Ast.Table.Invocation(null,
                newInvocation, action.schema.removeArgument(pname)),
                [C.notifyAction()]);
        }
        newHistoryItem = new Ast.DialogueHistoryItem(null, newStmt, null, confirm);
    }

    return addNewItem(ctx, dialogueAct, null, confirm, newHistoryItem);
}

function replaceAction(ctx, dialogueAct, action, confirm) {
    let newStmt = new Ast.Statement.Command(null, null, [new Ast.Action.Invocation(null, action, action.schema)]);
    let newHistoryItem = new Ast.DialogueHistoryItem(null, newStmt, null, confirm);

    return addNewItem(ctx, dialogueAct, null, confirm, newHistoryItem);
}

function addAction(ctx, dialogueAct, action, confirm) {
    assert(action instanceof Ast.Invocation);
    // note: parameters from the action are ignored altogether!

    let newHistoryItem;
    if (ctx.nextInfo) {
        const nextInvocation = C.getInvocation(ctx.next);
        if (C.isSameFunction(nextInvocation.schema, action.schema)) {
            assert(ctx.next.results === null);
            // case 1:
            // - we trying to propose an action that the user has already introduced
            // earlier
            // in that case, we want to remember the action as accepted, not proposed
            // case 2:
            // - we trying to accept or confirm the action that was previously proposed
            // in that case, we want to change the action to accepted or confirmed
            if (confirm === 'proposed' || confirm === ctx.next.confirm)
                return new Ast.DialogueState(null, POLICY_NAME, dialogueAct, null, ctx.state.history);

            newHistoryItem = new Ast.DialogueStateHistoryItem(null, ctx.next.stmt, null, confirm);
        }
    }

    if (!newHistoryItem) {
        let newStmt;
        let newInvocation = new Ast.Invocation(null,
            action.selector,
            action.channel,
            [],
            action.schema
        );
        if (action.schema.functionType === 'action') {
            newStmt = new Ast.Statement.Command(null, null, [new Ast.Action.Invocation(null,
                newInvocation, action.schema
            )]);
        } else {
            newStmt = new Ast.Statement.Command(null, new Ast.Table.Invocation(null,
                newInvocation, action.schema),
                [C.notifyAction()]);
        }
        newHistoryItem = new Ast.DialogueHistoryItem(null, newStmt, null, confirm);
    }

    return addNewItem(ctx, dialogueAct, null, confirm, newHistoryItem);
}

function addQuery(ctx, dialogueAct, newTable, confirm) {
    newTable = C.adjustDefaultParameters(newTable);
    let newStmt = new Ast.Statement.Command(null, newTable, [C.notifyAction()]);
    let newHistoryItem = new Ast.DialogueHistoryItem(null, newStmt, null, confirm);

    // add the new history item right after the current one, and remove all proposed elements

    assert(ctx.currentIdx !== null);
    const newState = new Ast.DialogueState(null, POLICY_NAME, dialogueAct, null, []);
    for (let i = 0; i <= ctx.currentIdx; i++)
        newState.history.push(ctx.state.history[i]);
    newState.history.push(newHistoryItem);
    for (let i = ctx.currentIdx + 1; i < ctx.state.history.length; i++) {
        if (ctx.state.history[i].confirm === 'proposed')
            continue;
        newState.history.push(ctx.state.history[i]);
    }

    return newState;
}

function addQueryAndAction(ctx, dialogueAct, newTable, newAction, confirm) {
    let newTableStmt = new Ast.Statement.Command(null, newTable, [C.notifyAction()]);
    let newTableHistoryItem = new Ast.DialogueHistoryItem(null, newTableStmt, null, confirm);

    // add the new table history item right after the current one, and replace everything after that

    let newActionStmt = new Ast.Statement.Command(null, null, [new Ast.Action.Invocation(null, newAction, newAction.schema)]);
    let newActionHistoryItem = new Ast.DialogueHistoryItem(null, newActionStmt, null, confirm);

    return addNewItem(ctx, dialogueAct, null, confirm, newTableHistoryItem, newActionHistoryItem);
}

/**
 * Construct a full formal reply from the agent.
 *
 * The reply contains:
 * - the agent state (a ThingTalk dialogue state passed to the NLU and NLG networks)
 * - the agent reply tags (a list of strings that define the context tags on the user side)
 * - the interaction state (the expected type of the reply, if any, and a boolean indicating raw mode)
 * - extra information for the new context
 */
function makeAgentReply(ctx, state, aux = null, expectedType = null, options = {}) {
    assert(state instanceof Ast.DialogueState);
    assert(state.dialogueAct.startsWith('sys_'));
    assert(expectedType === null || expectedType instanceof ThingTalk.Type);

    const newContext = getContextInfo(state);
    // set the auxiliary information, which is used by the semantic functions of the user
    // to see if the continuation is compatible with the specific reply from the agent
    newContext.aux = aux;

    let mainTag;
    if (state.dialogueAct === 'sys_generic_search_question')
        mainTag = 'ctx_sys_search_question';
    else if (state.dialogueAct.endsWith('_question') && state.dialogueAct !== 'sys_search_question')
        mainTag = 'ctx_' + state.dialogueAct.substring(0, state.dialogueAct.length - '_question'.length);
    else if (state.dialogueAct.startsWith('sys_recommend_') && state.dialogueAct !== 'sys_recommend_one')
        mainTag = 'ctx_sys_recommend_many';
    else
        mainTag = 'ctx_' + state.dialogueAct;

    // if true, the interaction is done and the agent should stop listening
    // these dialogue acts are considered to "end" the conversation:
    // sys_recommend_*, sys_action_success, sys_action_error
    // provided no thingtalk statement is left to do (accepted or proposed)
    // the user can still continue, but the agent won't be listening unless woken up
    // (specific semantic functions can override)
    let end = options.end;
    if (end === undefined) {
        end = !state.history.some((item) => item.results === null) &&
            (state.dialogueAct.startsWith('sys_recommend_') ||
            ['sys_action_success', 'sys_action_error', 'sys_end', 'sys_display_result'].includes(state.dialogueAct));
    }

    return {
        state,
        context: newContext,
        tags: ['ctx_sys_any', mainTag, ...getContextTags(newContext)],
        expect: expectedType,

        end: end,
        // if true, enter raw mode for this user's turn
        // (this is used for slot filling free-form strings)
        raw: !!options.raw
    };
}

function setEndBit(reply, value) {
    const newReply = {};
    Object.assign(newReply, reply);
    newReply.end = value;
    return newReply;
}

function tagContextForAgent(ctx) {
    switch (ctx.state.dialogueAct){
    case 'end':
        // no continuations are possible after explicit "end" (which means the user said
        // "no thanks" after the agent asked "is there anything else I can do for you")
        // but we still tag the context to generate something in inference mode
        return ['ctx_end'];

    case 'greet':
        assert(ctx.state.history.length === 0, `expected empty history for greet`);
        return ['ctx_greet'];

    case 'cancel':
        return ['ctx_cancel'];

    case 'action_question':
        return ['ctx_completed_action_success'];

    case 'learn_more':
        assert(ctx.results);
        return ['ctx_learn_more'];

    case 'execute':
    case 'ask_recommend':
        if (ctx.nextInfo !== null) {
            // we have an action we want to execute, or a query that needs confirmation
            if (ctx.nextInfo.chainParameter === null || ctx.nextInfo.chainParameterFilled) {
                // we don't need to fill any parameter from the current query

                if (ctx.nextInfo.isComplete)
                    return ['ctx_confirm_action'];
                else
                    return ['ctx_incomplete_action_after_search'];
            }
        }

        // we must have a result
        assert(ctx.resultInfo, `expected result info`);
        if (!ctx.resultInfo.isTable) {
            if (ctx.resultInfo.hasError)
                return ['ctx_completed_action_error'];
            else if (ctx.resultInfo.hasEmptyResult)
                return ['ctx_completed_action_success'];
            else
                return ['ctx_completed_action_success'];
        }

        if (ctx.resultInfo.hasEmptyResult) {
            // note: aggregation cannot be empty (it would be zero)
            return ['ctx_empty_search_command'];
        }

        if (!ctx.resultInfo.isList) {
            return ['ctx_display_nonlist_result'];
        } else if (ctx.resultInfo.isQuestion) {
            if (ctx.resultInfo.isAggregation) {
                // "how many restaurants nearby have more than 500 reviews?"
                return ['ctx_aggregation_question'];
            } else if (ctx.resultInfo.argMinMaxField !== null) {
                /* FIXME
                const [field, direction] = info.resultInfo.argMinMaxField;
                // for now, we treat these as single result questions
                if (field === 'distance') // "find the nearest starbucks"
                    tags.push('ctx_distance_argminmax_question');
                else // "what is the highest rated restaurant nearby?"
                    tags.push('ctx_argminmax_question');
                */
                return ['ctx_single_result_search_command', 'ctx_complete_search_command'];
            } else if (ctx.resultInfo.hasSingleResult) {
                // "what is the rating of Terun?"
                // FIXME if we want to answer differently, we need to change this one
                return ['ctx_single_result_search_command', 'ctx_complete_search_command'];
            } else {
                // "what's the food and price range of restaurants nearby?"
                // we treat these the same as "find restaurants nearby", but we make sure
                // that the necessary fields are computed
                return ['ctx_search_command', 'ctx_complete_search_command'];
            }
        } else {
            if (ctx.resultInfo.hasSingleResult || ctx.resultInfoQuestion) // we can recommend
                return ['ctx_single_result_search_command', 'ctx_complete_search_command'];
            else if (ctx.state.dialogueAct !== 'ask_recommend') // we can refine
                return ['ctx_search_command', 'ctx_complete_search_command'];
            else
                return ['ctx_complete_search_command'];
        }

    default:
        throw new Error(`Unexpected user dialogue act ${ctx.state.dialogueAct}`);
    }
}

function ctxCanHaveRelatedQuestion(ctx) {
    const currentTable = ctx.current.stmt.table;
    if (!currentTable)
        return false;
    const related = currentTable.schema.getAnnotation('related');
    if (!currentTable.schema.getAnnotation) // FIXME ExpressionSignature that is not a FunctionDef - not sure how it happens...
        return false;
    return related && related.length;
}

function getContextTags(ctx) {
    const tags = [];
    if (ctx.isMultiDomain)
        tags.push('ctx_multidomain');

    if (ctx.nextInfo !== null) {
        tags.push('ctx_with_action');

        if (!ctx.nextInfo.isComplete)
            tags.push('ctx_incomplete_action');
    } else {
        if (ctx.resultInfo && ctx.resultInfo.isTable)
            tags.push('ctx_without_action');
    }
    if (!ctx.resultInfo || ctx.resultInfo.hasEmptyResult)
        return tags;

    assert(ctx.results.length > 0);
    tags.push('ctx_with_result');
    if (ctxCanHaveRelatedQuestion(ctx))
        tags.push('ctx_for_related_question');
    if (isUserAskingResultQuestion(ctx)) {
        tags.push('ctx_with_result_question');
    } else {
        tags.push('ctx_with_result_noquestion');
        if (ctx.nextInfo)
            tags.push('ctx_with_result_and_action');

        if (ctx.resultInfo.projection === null)
            tags.push('ctx_without_projection');
    }
    return tags;
}

module.exports = {
    POLICY_NAME,
    INITIAL_CONTEXT_INFO,
    makeAgentReply,
    setEndBit,

    // compute derived information of the state
    getContextInfo,
    getContextTags,
    tagContextForAgent,
    isUserAskingResultQuestion,

    // manipulate states to create new states
    sortByName,
    makeSimpleState,
    addNewItem,
    addActionParam,
    addAction,
    addQuery,
    addQueryAndAction,
    replaceAction,
    mergeParameters,
    setOrAddInvocationParam,
};
