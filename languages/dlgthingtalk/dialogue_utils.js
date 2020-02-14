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
    // agent recommends the result from the program
    'sys_recommend_one',
    // agent proposes a refined query
    'sys_propose_refined_query',
    // agent recommends/suggests an action
    'sys_recommend_action',
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

class ResultInfo {
    constructor(item) {
        assert(item.results !== null);
        this.isTable = !!(item.stmt.table && item.stmt.actions.every((a) => a.isNotify));
        this.isQuestion = item.stmt.table.isProjection || item.stmt.table.isAggregation;
        this.hasEmptyResult = item.results.results.length === 0;
        this.hasSingleResult = item.results.results.length === 1;
        this.hasLargeResult = isLargeResultSet(item.results);
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
            if (in_param.name === this.chainParameter) {
                this.chainParameterFilled = true;
                break;
            }
        }
    }
}

class ContextInfo {
    constructor(state, currentFunction, resultInfo, currentIdx, nextIdx, nextInfo) {
        this.state = state;
        this.currentFunction = currentFunction;
        this.resultInfo = resultInfo;
        this.currentIdx = currentIdx;
        this.nextIdx = nextIdx;
        this.nextInfo = nextInfo;
    }

    get current() {
        return this.currentIdx !== null ? this.state.history[this.currentIdx] : null;
    }

    get next() {
        return this.nextIdx !== null ? this.state.history[this.nextIdx] : null;
    }

    clone() {
        return new ContextInfo(this.state.clone(), this.currentFunction, this.resultInfo,
            this.currentIdx, this.nextIdx, this.nextInfo);
    }
}

function getContextInfo(state) {
    assert (!state.dialogueAct.startsWith('sys_'), `Unexpected system dialogue act ${state.dialogueAct}`);

    let nextItemIdx = null, nextInfo = null, currentFunction = null, currentResultInfo = null, currentItemIdx = null;
    for (let idx = 0; idx < state.history.length; idx ++) {
        const item = state.history[idx];
        if (item.results === null) {
            nextItemIdx = idx;
            nextInfo = new NextStatementInfo(state.history[currentItemIdx], currentResultInfo, item);
            break;
        }
        const functions = C.getFunctionNames(item.stmt);
        if (functions.length > 0) {
            currentFunction = functions[functions.length-1];
            currentItemIdx = idx;
            currentResultInfo = new ResultInfo(item, functions);
        }
    }
    return new ContextInfo(state, currentFunction, currentResultInfo, currentItemIdx, nextItemIdx, nextInfo);
}

function getActionInvocation(historyItem) {
    return historyItem.stmt.actions[0].invocation;
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

function makeActionRecommendation(ctx, action) {
    assert(action instanceof Ast.Invocation);

    const results = ctx.current.results.results;
    assert(results.length > 0);

    const topResult = results[0];
    const id = topResult.value.id;

    for (let param of action.in_params) {
        if (param.value.equals(id))
            return [topResult, action];
    }

    return null;
}

function makeRecommendation(ctx, name) {
    const results = ctx.current.results.results;
    assert(results.length > 0);

    const topResult = results[0];
    const id = topResult.value.id;

    if (!id || !id.equals(name))
        return null;

    return [topResult, ctx.nextInfo && ctx.nextInfo.isAction ? getActionInvocation(ctx.next) : null];
}

function checkRecommendation([topResult, nextAction], info) {
    const resultType = topResult.value.id.getType();
    const idType = info.schema.getArgType('id');

    if (!idType || !idType.equals(resultType))
        return null;

    assert(info.isFilter && info.table.isInvocation);
    if (!isFilterCompatibleWithResult(topResult, info.filter))
        return null;

    return [topResult, nextAction];
}

function checkActionForRecommendation([topResult, nextAction], action) {
    const resultType = topResult.value.id.getType();

    if (nextAction !== null) {
        if (!C.isSameFunction(nextAction.schema, action.schema))
            return null;
    }

    if (!C.hasArgumentOfType(action, resultType))
        return null;

    return null;
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

        // FIXME not all actions should be killed, only those that need param passing to be resolved...
        if (!stmt.table)
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
    //if (ctxFilterTable === null)
    //    return null;

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

function impreciseSearchQuestionAnswer(ctx, preamble, [question, answer]) {
    if (preamble !== null) {
        const [base, num, more] = preamble;
        if (base !== ctx.currentFunction)
            return null;
        if (num !== null && !num.equals(ctx.current.count))
            return null;
        if (more !== ctx.current.more)
            return null;
    }

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

function addActionParam(ctxClone, dialogueAct, action, pname, value, confirm = false) {
    assert(action instanceof Ast.Invocation);
    const state = ctxClone.state;
    state.dialogueAct = dialogueAct;
    state.dialogueActParam = null;

    if (ctxClone.nextInfo) {
        const nextInvocation = getActionInvocation(ctxClone.next);
        if (C.isSameFunction(nextInvocation, action.schema)) {
            for (let in_param of nextInvocation.in_params) {
                if (in_param.name === pname) {
                    in_param.value = value;
                    return state;
                }
            }
            nextInvocation.in_params.push(new Ast.InputParam(null, pname, value));
            nextInvocation.in_params((p1, p2) => {
                if (p1.name < p2.name)
                    return -1;
                if (p1.name > p2.name)
                    return 1;
                return 0;
            });

            ctxClone.next.confirm = confirm;
            return state;
        }
    }

    let newStmt = new Ast.Statement.Command(null, null, [new Ast.Action.Invocation(null,
        new Ast.Invocation(null,
            action.selector,
            action.channel,
            [new Ast.InputParam(null, pname, value)],
            action.schema
        ),
        action.schema.removeArgument(pname)
    )]);
    let newHistoryItem = new Ast.DialogueHistoryItem(null, newStmt, null, confirm);

    // wipe everything from state after the current program
    // this will remove all intermediate results between the current program and the next one,
    // and remove the next program, if any

    state.history.splice(ctxClone.currentIdx+1, state.history.length-(ctxClone.currentIdx+1), newHistoryItem);
    return state;
}

function findChainParam(topResult, action) {
    const resultType = topResult.value.id.getType();

    let chainParam = undefined;
    for (let arg of action.schema.iterateArguments()) {
        if (arg.type.equals(resultType)) {
            chainParam = arg.name;
            break;
        }
    }
    assert(chainParam);
    return chainParam;
}

function negativeRecommendationReplyPair(ctx, [topResult, action, request]) {
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
    let sysState;
    if (action === null)
        sysState = makeSimpleSystemState(ctx, 'sys_recommend_one', null);
    else
        sysState = addActionParam(ctx.clone(), 'sys_recommend_action', action, findChainParam(topResult, action), topResult.value.id);
    return checkStateIsValid(ctx, sysState, userState);
}

function positiveRecommendationReplyPair(ctx, [topResult, action]) {
    // if the user did not give an action earlier, and no action
    // was proposed by the agent right now, the flow is roughly
    //
    // U: hello i am looking for a restaurant
    // A: how about the ... ?
    // U: sure I like that
    //
    // this doesn't make much sense, so we don't want this flow
    if (action === null)
        return null;

    const chainParam = findChainParam(topResult, action);

    const userState = addActionParam(ctx.clone(), 'execute', action, chainParam, topResult.value.id);
    const sysState = addActionParam(ctx.clone(), 'sys_recommend_action', action, chainParam, topResult.value.id);
    return checkStateIsValid(ctx, sysState, userState);
}

function impreciseSearchQuestionAnswerPair(question, answer) {
    if (answer instanceof Ast.BooleanExpression) {
        let pname;
        if (answer.isNot) {
            assert(answer.expr.isAtom);
            pname = answer.expr.name;
        } else {
            assert(answer.isAtom);
            pname = answer.name;
        }
        if (pname !== question)
            return null;

        return [question, answer];
    } else {
        assert(answer instanceof Ast.Value);
        return [question, C.makeFilter(question, '==', answer)];
    }
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
    makeActionRecommendation,
    makeRecommendation,
    checkRecommendation,
    checkActionForRecommendation,
    makeRefinementProposal,

    // user dialogue acts
    initialRequest,
    queryRefinement,
    refineFilterToAnswerQuestion,
    refineFilterToChangeFilter,

    // templates
    preciseSearchQuestionAnswer,
    impreciseSearchQuestionAnswerPair,
    impreciseSearchQuestionAnswer,
    proposalReplyPair,
    negativeRecommendationReplyPair,
    positiveRecommendationReplyPair
};
