// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');
const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const C = require('./ast_manip');

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

/**
 * Enable assertions
 */
const DEBUG = true;

// Helper classes for info that we extract from the current context
// These exist to minimize AST traversals during expansion

// NOTE: while ast_manip is mostly just about ThingTalk semantics, with
// a few heuristics sprinkled out, this is really only about the "transaction"
// dialogue policy
// hence we hard-code the policy name here, and check it before doing anything
// in the templates
// templates can be combined though

const POLICY_NAME = 'org.thingpedia.dialogue.transaction';

const USER_DIALOGUE_ACTS = new Set([
    // user says hi!
    'greet',
    // user issues a ThingTalk program
    'execute',
    // user wants to see the result of the previous program (in reply to a generic search question)
    'ask_recommend',

    // user insists in reiterating the same search after an empty search error
    'insist',

    // user wants to see more output from the previous result
    'learn_more',

    // user says closes the dialogue mid-way (in the middle of a search)
    'cancel',

    // user terminates the dialogue after the agent asked if there is anything
    // else the user wants
    // "end" is a terminal state, it has no continuations
    'end',
]);

const SYSTEM_DIALOGUE_ACTS = new Set([
    // agent says hi back
    'sys_greet',
    // agent asks a question to refine a query (with or without a parameter)
    'sys_search_question',
    'sys_generic_search_question',
    // agent asks a question to slot fill a program
    'sys_slot_fill',
    // agent recommends one, two, or three results from the program (with or without an action)
    'sys_recommend_one',
    'sys_recommend_two',
    'sys_recommend_three',
    // agent proposes a refined query
    'sys_propose_refined_query',
    // agent asks the user what they would like to hear
    'sys_learn_more_what',
    // agent informs that the search is empty (with and without a slot-fill question)
    'sys_empty_search_question',
    'sys_empty_search',

    // agent executed the action successfully (and shows the result of the action)
    'sys_action_success',

    // agent had an error in executing the action (with and without a slot-fill question)
    'sys_action_error_question',
    'sys_action_error',

    // agent asks if anything else is needed
    'sys_anything_else',

    // agent says good bye
    'sys_goodbye',
]);

const SYSTEM_STATE_MUST_HAVE_PARAM = new Set([
    'sys_search_question',
    'sys_slot_fill',
    'sys_empty_search_question',
    'sys_action_error_question',
]);

const INITIAL_CONTEXT_INFO = {};

/**
 * Check the dialogue state for internal consistency and invariants of the policy
 *
 * This method is called by all $root templates
 * If debugging is disabled, this method does nothing (and we just hope for the best!)
 */
function checkStateIsValid(ctx, sysState, userState) {
    if (!DEBUG)
        return [sysState, userState];

    assert(USER_DIALOGUE_ACTS.has(userState.dialogueAct), `invalid user dialogue act ${userState.dialogueAct}`);
    assert(userState.dialogueActParam === null);

    if (ctx === INITIAL_CONTEXT_INFO) {
        // user speaks first
        assert(sysState === null);
        return [sysState, userState];
    }

    assert(SYSTEM_DIALOGUE_ACTS.has(sysState.dialogueAct), `invalid system dialogue act ${sysState.dialogueAct}`);
    if (SYSTEM_STATE_MUST_HAVE_PARAM.has(sysState.dialogueAct))
        assert(sysState.dialogueActParam);
    else
        assert(sysState.dialogueActParam === null);

    return [sysState, userState];
}

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
    constructor(item) {
        assert(item.results !== null);
        this.isTable = !!(item.stmt.table && item.stmt.actions.every((a) => a.isNotify));

        if (this.isTable) {
            const table = item.stmt.table;
            // if there is a compute at top-level, there is a projection too
            assert(!table.isCompute);
            this.isQuestion = !!(table.isProjection || table.isCompute || table.isIndex || table.isAggregation);
            this.isAggregation = !!table.isAggregation;
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
        this.isComplete = C.isCompleteCommand(nextItem.stmt);

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
    constructor(state, currentFunctionSchema, resultInfo, currentIdx, nextIdx, nextFunctionSchema, nextInfo) {
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

    get current() {
        return this.currentIdx !== null ? this.state.history[this.currentIdx] : null;
    }

    get next() {
        return this.nextIdx !== null ? this.state.history[this.nextIdx] : null;
    }

    clone() {
        return new ContextInfo(this.state.clone(), this.currentFunctionSchema, this.resultInfo,
            this.currentIdx, this.nextIdx, this.nextFunctionSchema, this.nextInfo);
    }
}

function getContextInfo(state) {
    assert (!state.dialogueAct.startsWith('sys_'), `Unexpected system dialogue act ${state.dialogueAct}`);

    let nextItemIdx = null, nextInfo = null, currentFunction = null, nextFunction = null, currentResultInfo = null,
        currentItemIdx = null;
    for (let idx = 0; idx < state.history.length; idx ++) {
        const item = state.history[idx];
        const functions = C.getFunctions(item.stmt);
        if (item.results === null) {
            nextItemIdx = idx;
            nextFunction = functions[functions.length-1];
            nextInfo = new NextStatementInfo(state.history[currentItemIdx], currentResultInfo, item);
            break;
        }
        currentFunction = functions[functions.length-1];
        currentItemIdx = idx;
        currentResultInfo = new ResultInfo(item);
    }
    if (nextItemIdx !== null)
        assert(nextInfo);
    if (nextItemIdx !== null && currentItemIdx !== null)
        assert(nextItemIdx === currentItemIdx + 1);

    return new ContextInfo(state, currentFunction, currentResultInfo,
        currentItemIdx, nextItemIdx, nextFunction, nextInfo);
}

function isUserAskingResultQuestion(ctx) {
    // is the user asking a question about the result (or a specific element), or refining a search?
    // we say it's a question if the user is asking a projection question, and it's not the first turn,
    // and the projection was different at the previous turn

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
    let previousResultInfo = new ResultInfo(previous);
    if (!previousResultInfo.projection)
        return true;

    // it's a question if the current projection is not a subset of the previous one
    // (for a search refinement: it might be exactly the same as before, or we might have
    // lost some parameters because we put a filter on it)
    return !arraySubset(currentProjection, previousResultInfo.projection);
}

function getActionInvocation(historyItem) {
    return historyItem.stmt.actions[0].invocation;
}

function addNewItem(ctx, dialogueAct, dialogueActParam, newHistoryItem, confirm) {
    const newState = new Ast.DialogueState(null, POLICY_NAME, dialogueAct, dialogueActParam, []);

    if (confirm === 'proposed') {
        // find the first item that was not confirmed or accepted, and replace everything after that

        for (let i = 0; i < ctx.state.history.length; i++) {
            if (ctx.state.history[i].confirm === 'proposed')
                break;
            newState.history.push(ctx.state.history[i]);
        }
        newState.history.push(newHistoryItem);
    } else {
        // wipe everything from state after the current program
        // this will remove all previously accepted and/or proposed actions
        //
        // XXX is the right thing to do?
        if (ctx.currentIdx !== null) {
            for (let i = 0; i <= ctx.currentIdx; i++)
                newState.history.push(ctx.state.history[i]);
        }
        newState.history.push(newHistoryItem);
    }

    return newState;
}

function makeSimpleState(ctx, dialogueAct, dialogueActParam) {
    return new Ast.DialogueState(null, POLICY_NAME, dialogueAct, dialogueActParam, ctx.state.history);
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
        newInvocation.in_params((p1, p2) => {
            if (p1.name < p2.name)
                return -1;
            if (p1.name > p2.name)
                return 1;
            return 0;
        });
    }
}

function addActionParam(ctx, dialogueAct, action, pname, value, confirm) {
    assert(action instanceof Ast.Invocation);
    assert(['accepted', 'confirmed', 'proposed'].indexOf(confirm) >= 0);

    let newHistoryItem;
    if (ctx.nextInfo) {
        const nextInvocation = getActionInvocation(ctx.next);
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
            const newInvocation = getActionInvocation(newHistoryItem);
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

        let newStmt = new Ast.Statement.Command(null, null, [new Ast.Action.Invocation(null,
            new Ast.Invocation(null,
                action.selector,
                action.channel,
                in_params,
                action.schema
            ),
            action.schema.removeArgument(pname)
        )]);
        newHistoryItem = new Ast.DialogueHistoryItem(null, newStmt, null, confirm);
    }

    return addNewItem(ctx, dialogueAct, null, newHistoryItem, confirm);
}

function replaceAction(ctx, dialogueAct, action, confirm) {
    let newStmt = new Ast.Statement.Command(null, null, [new Ast.Action.Invocation(null, action, action.schema)]);
    let newHistoryItem = new Ast.DialogueHistoryItem(null, newStmt, null, confirm);

    return addNewItem(ctx, dialogueAct, null, newHistoryItem, confirm);
}

function addAction(ctx, dialogueAct, action, confirm) {
    assert(action instanceof Ast.Invocation);
    // note: parameters from the action are ignored altogether!

    let newHistoryItem;
    if (ctx.nextInfo) {
        const nextInvocation = getActionInvocation(ctx.next);
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
        let newStmt = new Ast.Statement.Command(null, null, [new Ast.Action.Invocation(null,
            new Ast.Invocation(null,
                action.selector,
                action.channel,
                [],
                action.schema
            ),
            action.schema
        )]);
        newHistoryItem = new Ast.DialogueHistoryItem(null, newStmt, null, confirm);
    }

    return addNewItem(ctx, dialogueAct, null, newHistoryItem, confirm);
}

function addQuery(ctx, dialogueAct, newTable, confirm) {
    let newStmt = new Ast.Statement.Command(null, newTable, [C.notifyAction()]);
    let newHistoryItem = new Ast.DialogueHistoryItem(null, newStmt, null, confirm);

    // add the new history item right after the current one, without removing any element
    // NOTE: this assumes that ctx comes from the user's, so it will not have any proposal
    // in it, otherwise we'd have to remove all proposals between the current item and the next
    // accepted item

    assert(ctx.currentIdx !== null);
    const newState = new Ast.DialogueState(null, POLICY_NAME, dialogueAct, null, []);
    for (let i = 0; i <= ctx.currentIdx; i++)
        newState.history.push(ctx.state.history[i]);
    newState.history.push(newHistoryItem);
    for (let i = ctx.currentIdx + 1; i < ctx.state.history.length; i++)
        newState.history.push(ctx.state.history[i]);

    return newState;
}

module.exports = {
    POLICY_NAME,
    INITIAL_CONTEXT_INFO,

    // compute derived information of the state
    getContextInfo,
    getActionInvocation,
    isUserAskingResultQuestion,
    checkStateIsValid,

    // manipulate states to create new states
    makeSimpleState,
    addActionParam,
    addAction,
    addQuery,
    replaceAction,
    setOrAddInvocationParam,
};
