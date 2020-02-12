// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017-2018 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const C = require('./ast_manip');
const _loader = require('./load-thingpedia');

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
]);

const SYSTEM_DIALOGUE_ACTS = new Set([
    // agent says hi back
    'sys_greet',
    // agent asks a question to refine a query (with or without a parameter)
    'sys_search_question',
    'sys_generic_search_question',
    // agent asks a question to slot fill a program
    'sys_slot_fill',
    // agent recommends a result from the program, or proposes a refined query
    'sys_propose_refined_query',
]);

const SYSTEM_STATE_MUST_HAVE_PARAM = new Set([
    'sys_search_question',
    'sys_slot_fill'
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

    assert(USER_DIALOGUE_ACTS.has(userState.dialogueAct));
    assert(userState.dialogueActParam === null);

    if (ctx === INITIAL_CONTEXT_INFO) {
        // user speaks first
        assert(sysState === null);
        return [sysState, userState];
    }

    assert(SYSTEM_DIALOGUE_ACTS.has(sysState.dialogueAct));
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

class ResultInfo {
    constructor(item) {
        assert(item.results !== null);
        this.isTable = !!(item.stmt.table && item.stmt.actions.every((a) => a.isNotify));
        this.hasEmptyResult = item.results.results.length === 0;
        this.hasSingleResult = item.results.results.length === 1;
        this.hasLargeResult = isLargeResultSet(item.results);
    }
}

class ContextInfo {
    constructor(state, currentFunction, resultInfo, currentIdx, nextIdx) {
        this.state = state;
        this.currentFunction = currentFunction;
        this.resultInfo = resultInfo;
        this.currentIdx = currentIdx;
        this.nextIdx = nextIdx;
    }

    get current() {
        return this.currentIdx !== null ? this.state.history[this.currentIdx] : null;
    }

    clone() {
        return new ContextInfo(this.state.clone(), this.currentFunction, this.resultInfo, this.currentIdx, this.nextIdx);
    }
}

function getContextInfo(state) {
    assert (!state.dialogueAct.startsWith('sys_'), `Unexpected system dialogue act ${state.dialogueAct}`);

    let nextItemIdx = null, currentFunction = null, currentResultInfo = null, currentItemIdx = null;
    for (let idx = 0; idx < state.history.length; idx ++) {
        const item = state.history[idx];
        if (item.results === null) {
            nextItemIdx = idx;
            break;
        }
        const functions = C.getFunctionNames(item.stmt);
        if (functions.length > 0) {
            currentFunction = functions[functions.length-1];
            currentItemIdx = idx;
            currentResultInfo = new ResultInfo(item, functions);
        }
    }
    return new ContextInfo(state, currentFunction, currentResultInfo, currentItemIdx, nextItemIdx);
}

function isFilterCompatibleWithResult(topResult, filter) {
    if (filter.isTrue)
        return true;
    if (filter.isFalse)
        return false;
    if (filter.isAnd)
        return filter.operands.every((op) => isFilterCompatibleWithResult(topResult, op));
    if (filter.isOr)
        return filter.operands.some((op) => isFilterCompatibleWithResult(topResult, op));
    if (filter.isNot)
        return !isFilterCompatibleWithResult(topResult, filter.expr);

    if (filter.isExternal) // approximate
        return true;

    if (filter.isCompute) // approximate
        return true;

    const values = topResult.value;
    // if the value was not returned, don't verbalize it
    if (!values[filter.name])
        return false;

    const resultValue = topResult.value[filter.name];
    switch (filter.operator) {
    case '==':
    case '=~':
        // approximate: all strings are made up so we don't need a true likeTest here
        return resultValue.toJS() === filter.value.toJS();

    default:
        // approximate
        return true;
    }
}

function makeRecommendation(ctx, [name, nametable], info) {
    const results = ctx.current.results.results;
    assert(results.length > 0);

    const topResult = results[0];
    const id = topResult.value.id;
    if (!id || !id.equals(name))
        return null;

    if (info === null)
        return nametable;

    assert(nametable.isFilter && nametable.table.isInvocation);
    if (!C.isSameFunction(nametable.schema, info.schema))
        return null;

    assert(info.isFilter && info.table.isInvocation);
    if (!isFilterCompatibleWithResult(topResult, info.filter))
        return null;

    const clone = nametable.clone();
    clone.filter = new Ast.BooleanExpression.And(null, [clone.filter, info.filter]).optimize();
    return clone;
}

function makeRefinementProposal(ctx, proposal) {
    assert(proposal.isFilter && proposal.table.isInvocation);

    let ctxTable, ctxFilterTable;
    ctxTable = ctx.current.stmt.table;
    [ctxTable, ctxFilterTable] = findOrMakeFilterTable(ctxTable);
    assert(ctxFilterTable);
    if (ctxFilterTable === null)
        return null;

    const refinedFilter = refineFilterToAnswerQuestion(ctxFilterTable.filter, proposal.filter);
    if (refinedFilter === null)
        return null;
    return proposal;
}

function initialRequest(stmt) {
    if (stmt.stream && _loader.flags.no_stream)
        return null;

    let history = [];

    if (stmt.table && stmt.actions.some((a) => !a.isNotify)) {
        // split into two statements, one getting the data, and the other using it

        if (!stmt.table.isInvocation) {
            // if there is no filter, skip the statement
            const queryStmt = new Ast.Statement.Command(null, stmt.table, [C.notifyAction()]);
            history.push(new Ast.DialogueHistoryItem(null, queryStmt, null, false));
        }
        if (!C.checkValidQuery(stmt.table))
            return null;

        const newActions = stmt.actions.map((a) => a.clone());
        for (let action of newActions) {
            if (!action.isInvocation)
                throw new TypeError('???');
            assert (action.invocation.selector.isDevice);

            const in_params = action.invocation.in_params;
            for (let in_param of in_params) {
                if (!in_param.value.isVarRef)
                    continue;
                if (in_param.value.name.startsWith('__const_'))
                    continue;

                // parameter passing
                // FIXME we need a new ThingTalk value type...
                in_param.value = new Ast.Value.Undefined(true);
            }
        }
        const actionStmt = new Ast.Statement.Command(null, null, newActions);
        history.push(new Ast.DialogueHistoryItem(null, actionStmt, null, false));
    } else {
        if (stmt.table && !C.checkValidQuery(stmt.table))
            return null;

        history.push(new Ast.DialogueHistoryItem(null, stmt, null, false));
    }

    return new Ast.DialogueState(null, 'org.thingpedia.dialogue.transaction', 'execute', null, history);
}

/**
 * Check if the table filters on the parameter `question` (effectively providing a constraint on question)
 */
function isQueryAnswerValidForQuestion(table, question) {
    if (question === '')
        return true;
    let answersQuestion = false;
    table.visit(new class extends Ast.NodeVisitor {
        visitAtomBooleanExpression(atom) {
            if (atom.name === question)
                answersQuestion = true;
            return true;
        }
    });
    return answersQuestion;
}

/**
 * Find the filter table in the context.
 *
 * If we don't have one, make it up right before the invocation.
 *
 * Returns [root, filterTable]
 */
function findOrMakeFilterTable(root) {
    let table = root;
    let holder = null;
    while (!table.isFilter) {
        if (table.isSequence ||
            table.isHistory ||
            table.isWindow ||
            table.isTimeSeries)
            throw new Error('NOT IMPLEMENTED');

        // do not cross these with filters
        if (table.isSort ||
            table.isIndex ||
            table.isSlice ||
            table.isAggregation ||
            table.isVarRef ||
            table.isResultRef)
            return [null, null];

        // go inside these
        if (table.isProjection ||
            table.isCompute ||
            table.isAlias) {
            holder = table;
            table = table.table;
            continue;
        }

        if (table.isJoin) {
            holder = table;
            // go right on join, always
            table = table.rhs;
            continue;
        }

        assert(table.isInvocation);
        // if we get here, there is no filter table at all
        // make up one
        const newFilterTable = new Ast.Table.Filter(null, table, Ast.BooleanExpression.True, table.schema);
        if (holder === null) {
            assert(table === root);
            return [newFilterTable, newFilterTable];
        } else if (holder.isJoin) {
            holder.rhs = newFilterTable;
            return [root, newFilterTable];
        } else {
            holder.table = newFilterTable;
            return [root, newFilterTable];
        }
    }

    return [root, table];
}

function setsIntersect(s1, s2) {
    for (let el of s1) {
        if (s2.has(el))
            return true;
    }
    return false;
}

function getParamsInFilter(filter) {
    let params = new Set;
    filter.visit(new class extends Ast.NodeVisitor {
        visitAtomBooleanExpression(atom) {
            params.add(atom.name);
            return false;
        }
        visitExternalBooleanExpression() {
            return false;
        }
    });
    return params;
}

function refineFilterToAnswerQuestion(ctxFilter, refinedFilter) {
    // this function is used when:
    // - the agent asks a search refinement question, and the user answers it
    // - the agent proposes something to refine the question
    // - the agent proposes something, and the user replies with a bunch of filters
    // (e.g. "how about terun?" "nah i'm looking for something chinese")
    //
    // the refinement is allowed only if the parameter was not mentioned before

    if (setsIntersect(getParamsInFilter(ctxFilter),  getParamsInFilter(refinedFilter)))
        return null;

    return new Ast.BooleanExpression.And(null, [ctxFilter, refinedFilter]);
}

function filterToSlots(filter) {
    filter = filter.optimize();
    let operands, slots = {};
    if (filter.isAnd)
        operands = filter.operands;
    else
        operands = [filter];

    for (let operand of operands) {
        if (!operand.isAtom)
            continue;

        slots[operand.name] = operand;
    }

    return slots;
}

function filterEqual(atom1, atom2) {
    return atom1.operator === atom2.operator &&
        atom1.value.equals(atom2.value);
}

function refineFilterToChangeFilter(ctxFilter, refinedFilter) {
    // this function is used:
    // - when the agent returned zero results, and the user
    //   must change the search
    // - when the agent makes a filter proposal, and the user says no I want something else
    //
    // the refinement is allowed only if at least one parameter is different than before

    const ctxSlots = filterToSlots(ctxFilter);
    const refinedSlots = filterToSlots(refinedFilter);
    for (let key in ctxSlots) {
        if (refinedSlots[key] && filterEqual(refinedSlots[key], ctxSlots[key]))
            return null;
    }

    return refinedFilter;
}

function queryRefinement(ctxTable, newFilter, refineFilter) {
    let ctxFilterTable;
    [ctxTable, ctxFilterTable] = findOrMakeFilterTable(ctxTable);
    assert(ctxFilterTable);
    if (ctxFilterTable === null)
        return null;

    const refinedFilter = refineFilter(ctxFilterTable.filter, newFilter);
    if (refinedFilter === null)
        return null;

    ctxFilterTable.filter = refinedFilter;
    return ctxTable;
}

function makeSimpleSystemState(ctx, dialogueAct, dialogueActParam) {
    return new Ast.DialogueState(null, POLICY_NAME, dialogueAct, dialogueActParam, ctx.state.history);
}

function overrideCurrentQuery(ctxClone, newTable) {
    ctxClone.current.stmt.table = newTable;
    ctxClone.current.results = null;

    const state = ctxClone.state;
    state.dialogueAct = 'execute';
    state.dialogueActParam = null;
    // remove all intermediate results between the current program and the next one
    if (ctxClone.nextIdx !== null)
        state.history.splice(ctxClone.currentIdx+1, ctxClone.nextIdx-(ctxClone.currentIdx+1));
    else
        state.history.splice(ctxClone.currentIdx+1, state.history.length-(ctxClone.currentIdx+1));

    return state;
}

function preciseSearchQuestionAnswer(ctx, [question, answer]) {
    const answerFunctions = C.getFunctionNames(answer);
    assert(answerFunctions.length === 1);
    if (answerFunctions[0] !== ctx.currentFunction)
        return null;
    const currentTable = ctx.current.stmt.table;
    if (question !== '' && !currentTable.schema.out[question])
        return null;
    assert(answer.isFilter && answer.table.isInvocation);

    const clone = ctx.clone();
    const cloneTable = clone.current.stmt.table;
    const newTable = queryRefinement(cloneTable, answer.filter, refineFilterToAnswerQuestion);
    if (newTable === null)
        return null;
    const userState = overrideCurrentQuery(clone, newTable);
    let sysState;
    if (question === '')
        sysState = makeSimpleSystemState(ctx, 'sys_generic_search_question', null);
    else
        sysState = makeSimpleSystemState(ctx, 'sys_search_question', question);
    return checkStateIsValid(ctx, sysState, userState);
}

function impreciseSearchQuestionAnswer(ctx, [question, answer]) {
    const currentTable = ctx.current.stmt.table;
    if (question !== '' && !currentTable.schema.out[question])
        return null;
    if (!C.checkFilter(ctx.current.table, question))
        return null;

    const clone = ctx.clone();
    const cloneTable = clone.current.stmt.table;
    const newTable = queryRefinement(cloneTable, answer, refineFilterToAnswerQuestion);
    if (newTable === null)
        return null;
    const userState = overrideCurrentQuery(clone, newTable);
    const sysState = makeSimpleSystemState(ctx, 'sys_search_question', question);
    return checkStateIsValid(ctx, sysState, userState);
}

function makeSystemProposal(ctxClone, proposal) {
    assert(proposal.isFilter && proposal.table.isInvocation);
    const kind = proposal.table.invocation.selector.kind;
    const fn = proposal.table.invocation.channel;

    const propstatement = new Ast.Statement.Command(null,
        new Ast.Table.Filter(null, new Ast.Table.ResultRef(null, kind, fn, new Ast.Value.Number(1), proposal.schema), proposal.filter, proposal.schema),
        [C.notifyAction()]);

    const prophistoryitem = new Ast.DialogueHistoryItem(null, propstatement, null, false);

    // remove all intermediate results between the current program and the next one
    // and splice the new history item
    const state = ctxClone.state;
    state.dialogueAct = 'sys_propose_refined_query';
    state.dialogueActParam = null;

    if (ctxClone.nextIdx !== null)
        state.history.splice(ctxClone.currentIdx+1, ctxClone.nextIdx-(ctxClone.currentIdx+1), prophistoryitem);
    else
        state.history.splice(ctxClone.currentIdx+1, state.history.length-(ctxClone.currentIdx+1), prophistoryitem);

    return state;
}

function proposalReplyPair(ctx, [proposal, request]) {
    const requestFunctions = C.getFunctionNames(request);
    assert(requestFunctions.length === 1);
    if (requestFunctions[0] !== ctx.currentFunction)
        return null;
    assert(request.isFilter && request.table.isInvocation);

    const clone = ctx.clone();
    const cloneTable = clone.current.stmt.table;
    const newTable = queryRefinement(cloneTable, request.filter, refineFilterToAnswerQuestion);
    if (newTable === null)
        return null;

    const userState = overrideCurrentQuery(clone, newTable);
    const sysState = makeSystemProposal(ctx.clone(), proposal);
    return checkStateIsValid(ctx, sysState, userState);
}

module.exports = {
    // consistency checks
    POLICY_NAME,
    INITIAL_CONTEXT_INFO,
    checkStateIsValid,

    // system state manipulation
    makeSimpleSystemState,

    // user state manipulation,
    overrideCurrentQuery,

    // helpers
    getContextInfo,
    isQueryAnswerValidForQuestion,

    // system dialogue acts
    makeRecommendation,
    makeRefinementProposal,

    // user dialogue acts
    initialRequest,
    queryRefinement,
    refineFilterToAnswerQuestion,
    refineFilterToChangeFilter,

    // templates
    preciseSearchQuestionAnswer,
    impreciseSearchQuestionAnswer,
    proposalReplyPair
};
