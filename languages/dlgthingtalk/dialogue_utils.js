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
const Type = ThingTalk.Type;

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
    // user wants to see more output from the previous result
    'learn_more'
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
    'sys_empty_search'
]);

const SYSTEM_STATE_MUST_HAVE_PARAM = new Set([
    'sys_search_question',
    'sys_empty_search_question',
    'sys_slot_fill'
]);

const INITIAL_CONTEXT_INFO = {};

class SlotBag {
    constructor(schema) {
        this.schema = schema;
        this.store = new Map;
    }
    clone() {
        let newbag = new SlotBag(this.schema);
        for (let [key, value] of this.entries())
            newbag.set(key, value.clone());
        return newbag;
    }

    get size() {
        return this.store.size;
    }
    entries() {
        return this.store.entries();
    }
    get(key) {
        return this.store.get(key);
    }
    has(key) {
        return this.store.has(key);
    }
    keys() {
        return this.store.keys();
    }
    values() {
        return this.store.values();
    }
    [Symbol.iterator]() {
        return this.store[Symbol.iterator]();
    }
    set(key, value) {
        assert(value instanceof Ast.Value);
        this.store.set(key, value);
    }
    clear() {
        return this.store.clear();
    }
    delete(key) {
        return this.store.delete(key);
    }
}

function checkAndAddSlot(bag, filter) {
    assert(bag instanceof SlotBag);
    if (!filter.isAtom)
        return null;
    const ptype = bag.schema.getArgType(filter.name);
    if (!ptype)
        return null;
    const vtype = filter.value.getType();
    if (filter.operator === 'contains' || filter.operator === 'contains~') {
        if (!ptype.equals(new Type.Array(vtype)))
            return null;
        const clone = bag.clone();
        if (clone.has(filter.name))
            clone.get(filter.name).value.push(filter.value);
        else
            clone.set(filter.name, new Ast.Value.Array([filter.value]));
        return clone;
    } else {
        if (filter.operator !== '==' && filter.operator !== '=~')
            return null;
        if (!ptype.equals(vtype))
            return null;
        if (bag.has(filter.name))
            return null;
        const clone = bag.clone();
        clone.set(filter.name, filter.value);
        return clone;
    }
}

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
            this.projection = table.isProjection ? table.args : null;
        } else {
            this.isQuestion = false;
            this.isAggregation = false;
            this.argMinMaxField = null;
            this.projection = null;
        }
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

class ResultQuestionInfo {
    constructor(item, currentFunction, state) {
        assert(item.stmt.table);
        const projectionTable = item.stmt.table;
        assert(projectionTable.isProjection);
        const filterTable = projectionTable.table;
        assert(filterTable.isFilter);
        const resultRefTable = filterTable.table;
        assert(resultRefTable.isResultRef);
        assert(resultRefTable.kind === currentFunction.class.name &&
               resultRefTable.channel === currentFunction.name);

        this.projection = projectionTable.args;

        const filter = filterTable.filter;
        assert(filter.isAtom && filter.operator === '=='  &&
               filter.name === 'id');
    }
}

class ContextInfo {
    constructor(state, currentFunctionSchema, resultInfo, resultQuestionInfo, currentIdx, questionIdx, nextIdx, nextInfo) {
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
        this.resultQuestionInfo = resultQuestionInfo;
        this.currentIdx = currentIdx;
        this.questionIdx = questionIdx;
        assert(this.questionIdx !== this.currentIdx || (this.questionIdx === null && this.currentIdx === null));
        this.nextIdx = nextIdx;
        this.nextInfo = nextInfo;
    }

    get results() {
        if (this.questionIdx !== null)
            return this.state.history[this.questionIdx].results.results;
        if (this.currentIdx !== null)
            return this.state.history[this.currentIdx].results.results;
        return null;
    }

    get current() {
        return this.currentIdx !== null ? this.state.history[this.currentIdx] : null;
    }

    get question() {
        return this.questionIdx !== null ? this.state.history[this.questionIdx] : null;
    }

    get next() {
        return this.nextIdx !== null ? this.state.history[this.nextIdx] : null;
    }

    clone() {
        return new ContextInfo(this.state.clone(), this.currentFunctionSchema, this.resultInfo, this.resultQuestionInfo,
            this.currentIdx, this.questionIdx, this.nextIdx, this.nextInfo);
    }
}

function getContextInfo(state) {
    assert (!state.dialogueAct.startsWith('sys_'), `Unexpected system dialogue act ${state.dialogueAct}`);

    let nextItemIdx = null, nextInfo = null, currentFunction = null, currentResultInfo = null,
        questionItemIdx = null, currentResultQuestionInfo = null, currentItemIdx = null;
    for (let idx = 0; idx < state.history.length; idx ++) {
        const item = state.history[idx];
        if (item.results === null) {
            nextItemIdx = idx;
            nextInfo = new NextStatementInfo(state.history[currentItemIdx], currentResultInfo, item);
            break;
        }
        const functions = C.getFunctions(item.stmt);
        if (functions.length > 0) {
            currentFunction = functions[functions.length-1];
            currentItemIdx = idx;
            currentResultInfo = new ResultInfo(item, functions);
        } else {
            assert(currentResultInfo);
            questionItemIdx = idx;
            currentResultQuestionInfo = new ResultQuestionInfo(item, currentFunction, state);
        }
    }
    if (nextItemIdx !== null)
        assert(nextInfo);

    // the context should be composed of:
    // { history of length N } current [optional result question] { sequence of next programs }
    if (nextItemIdx !== null && currentItemIdx !== null)
        assert((nextItemIdx - currentItemIdx) > 0 && (nextItemIdx - currentItemIdx) <= 2);
    if (questionItemIdx !== null)
        assert(questionItemIdx === currentItemIdx + 1);

    return new ContextInfo(state, currentFunction, currentResultInfo, currentResultQuestionInfo,
        currentItemIdx, questionItemIdx, nextItemIdx, nextInfo);
}

function getActionInvocation(historyItem) {
    return historyItem.stmt.actions[0].invocation;
}

function isFilterCompatibleWithResult(topResult, filter) {
    if (filter.isTrue || filter.isDontCare)
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

function arraySubset(small, big) {
    for (let element of small) {
        let good = false;
        for (let candidate of big) {
            if (candidate.equals(element)) {
                good = true;
                break;
            }
        }
        if (!good)
            return false;
    }
    return true;
}

function isInfoPhraseCompatibleWithResult(topResult, info) {
    for (let [pname, infoValue] of info) {
        const resultValue = topResult.value[pname];
        if (!resultValue)
            return false;

        if (resultValue.isArray && infoValue.isArray) {
            if (!arraySubset(infoValue.value, resultValue.value))
                return false;
        } else {
            if (!resultValue.equals(infoValue))
                return false;
        }
    }
    return true;
}

function makeActionRecommendation(ctx, action) {
    assert(action instanceof Ast.Invocation);

    const results = ctx.results;
    assert(results.length > 0);

    const topResult = results[0];
    const id = topResult.value.id;
    if (!id)
        return null;

    for (let param of action.in_params) {
        if (param.value.equals(id))
            return { topResult, info: null, action };
    }

    return null;
}

function makeRecommendation(ctx, name) {
    const results = ctx.results;
    assert(results.length > 0);

    const topResult = results[0];
    const id = topResult.value.id;

    if (!id || !id.equals(name))
        return null;

    return { topResult, ctx, info: null, action: ctx.nextInfo && ctx.nextInfo.isAction ? getActionInvocation(ctx.next) : null };
}

function checkInfoPhrase(ctx, info) {
    if (ctx.currentFunction !== info.schema.class.name + ':' + info.schema.name)
        return null;

    // check that the filter uses the right set of parameters
    if (ctx.resultQuestionInfo) {
        // check that all projected names are present
        for (let name of ctx.resultQuestionInfo.projection) {
            if (!info.has(name))
                return null;
        }
    } else if (ctx.resultInfo.projection !== null) {
        // check that all projected names are present
        for (let name of ctx.resultInfo.projection) {
            if (!info.has(name))
                return null;
        }
    } else {
        // we must have at least one result to be here
        let topResult = ctx.results[0];
        assert(topResult);

        // check that the names are part of the #[default_projection], if one is specified
        for (let name of info.keys()) {
            if (!topResult.value[name])
                return null;
        }
    }

    // check that the filter is compatible with at least one of the top 3 results
    let good = false;
    const results = ctx.results;
    for (let i = 0; i < Math.min(3, results.length); i++) {
        if (isInfoPhraseCompatibleWithResult(results[i], info)) {
            good = true;
            break;
        }
    }

    if (good)
        return info;
    else
        return null;
}

function checkRecommendation({ topResult, action: nextAction }, info) {
    assert(info instanceof SlotBag);
    const resultType = topResult.value.id.getType();
    const idType = info.schema.getArgType('id');

    if (!idType || !idType.equals(resultType))
        return null;

    if (!isInfoPhraseCompatibleWithResult(topResult, info))
        return null;

    return { topResult, info, action: nextAction };
}

function makeShortUserQuestionAnswer({ topResult, ctx, action }, filter) {
    let info = new SlotBag(ctx.currentFunctionSchema);
    info = checkAndAddSlot(info, filter);
    if (info === null)
        return null;
    info = checkInfoPhrase(ctx, info);
    if (info === null)
        return null;

    return checkRecommendation({ topResult, action }, info);
}

function checkListProposal(ctx, results, info) {
    const resultType = results[0].value.id.getType();
    const idType = info.schema.getArgType('id');

    if (!idType || !idType.equals(resultType))
        return null;

    for (let result of results) {
        if (!isInfoPhraseCompatibleWithResult(result, info))
            return null;
    }

    const action = ctx.nextInfo && ctx.nextInfo.isAction ? getActionInvocation(ctx.next) : null;
    return [results, info, action];
}

function isFilterCompatibleWithInfo(info, filter) {
    assert(filter instanceof Ast.BooleanExpression);
    if (filter.isTrue || filter.isDontCare)
        return true;
    if (filter.isFalse)
        return false;
    if (filter.isOr)
        return filter.operands.some((op) => isFilterCompatibleWithInfo(info, op));
    if (filter.isAnd)
        return filter.operands.every((op) => isFilterCompatibleWithInfo(info, op));
    if (filter.isNot)
        return !isFilterCompatibleWithInfo(info, filter.expr);

    // approximate
    if (filter.isExternal || filter.isCompute)
        return true;

    assert(filter.isAtom);
    const pname = filter.name;
    if (!info.has(pname))
        return false;

    switch (filter.operator) {
    case '==':
    case '=~':
        return filter.value.equals(info.get(pname));

    case 'contains':
    case 'contains~':
        return info.get(pname).value.some((v) => v.equals(filter.value));

    case 'in_array':
    case 'in_array~':
        return filter.value.value.some((v) => v.equals(info.get(pname)));

    case '>=':
        return info.get(pname).toJS() >= filter.value.toJS();
    case '<=':
        return info.get(pname).toJS() <= filter.value.toJS();

    default:
        // approximate
        return true;
    }
}

function isValidNegativePreambleForInfo(info, preamble) {
    // the preamble must match the info provided
    // (and we will negate it later)
    return isFilterCompatibleWithInfo(info, preamble.filter);
}

function checkActionForRecommendation({ topResult, info, action: nextAction }, action) {
    const resultType = topResult.value.id.getType();

    if (nextAction !== null) {
        if (!C.isSameFunction(nextAction.schema, action.schema))
            return null;
    }

    if (!C.hasArgumentOfType(action, resultType))
        return null;

    return { topResult, info, action };
}

function makeRefinementProposal(ctx, proposal) {
    assert(proposal.isFilter && proposal.table.isInvocation);

    let ctxTable, ctxFilterTable;
    ctxTable = ctx.current.stmt.table.clone();
    [ctxTable, ctxFilterTable] = findOrMakeFilterTable(ctxTable);
    if (ctxFilterTable === null)
        return null;

    const refinedFilter = refineFilterToAnswerQuestion(ctxFilterTable.filter, proposal.filter);
    if (refinedFilter === null)
        return null;
    return proposal;
}

function mergePreambleAndRequest(pair, request) {
    const preamble = pair[pair.length-1];
    if (!C.isSameFunction(preamble.schema, request.schema))
        return null;
    const refined = refineFilterToChangeFilter(preamble.filter, request.filter);
    if (refined === null)
        return null;

    // convert the preamble into a request by negating it, then add the new request
    return [...pair.slice(0, pair.length-1), new Ast.Table.Filter(null, request.table, new Ast.BooleanExpression.And(null, [
        new Ast.BooleanExpression.Not(null, preamble.filter),
        request.filter
    ]), request.schema)];
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

        let newStatements = [];
        if (!stmt.table) {
            for (let action of stmt.actions) {
                for (let param of action.invocation.in_params) {
                    if (param.value.isUndefined) {
                        const type = action.invocation.schema.getArgType(param.name);
                        if (type.isEntity && _loader.idQueries.has(type.type)) {
                            const query = _loader.idQueries.get(type.type);
                            newStatements.push(new Ast.Statement.Command(null, new Ast.Table.Invocation(null,
                                new Ast.Invocation(null,
                                    new Ast.Selector.Device(null, query.class.name, null, null),
                                    query.name,
                                    [],
                                    query),
                                query), [C.notifyAction()]));
                        }
                    }
                }
            }
        }
        newStatements.push(stmt);

        for (let stmt of newStatements)
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
        visitDontCareBooleanExpression(atom) {
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

        // do not touch these with filters
        if (table.isAggregation ||
            table.isVarRef ||
            table.isResultRef)
            return [null, null];

        // go inside these
        if (table.isSort ||
            table.isIndex ||
            table.isSlice ||
            table.isProjection ||
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
        visitDontCareBooleanExpression(atom) {
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
    // furthermore, "id ==" filters are removed from the refined filter, so a user
    // can choose a restaurant for a while then change their mind

    if (setsIntersect(getParamsInFilter(ctxFilter),  getParamsInFilter(refinedFilter)))
        return null;

    function recursiveHelper(ast) {
        if (ast.isNot)
            return new Ast.BooleanExpression.Not(null, recursiveHelper(ast.expr));
        if (ast.isOr)
            return new Ast.BooleanExpression.Or(null, ast.operands.map(recursiveHelper));
        if (ast.isAnd)
            return new Ast.BooleanExpression.And(null, ast.operands.map(recursiveHelper));
        if (ast.isTrue || ast.isDontCare || ast.isFalse || ast.isCompute || ast.isExternal)
            return ast;

        assert(ast.isAtom);
        if (ast.name === 'id' && ast.operator === '==')
            return Ast.BooleanExpression.True;
        return ast;
    }
    const clone = recursiveHelper(ctxFilter).optimize();
    return new Ast.BooleanExpression.And(null, [clone, refinedFilter]);
}

function filterToSlots(filter) {
    filter = filter.optimize();
    let operands, slots = {};
    if (filter.isAnd)
        operands = filter.operands;
    else
        operands = [filter];

    for (let operand of operands) {
        if (!operand.isAtom && !operand.isDontCare)
            continue;

        slots[operand.name] = operand;
    }

    return slots;
}

function refineFilterToChangeFilter(ctxFilter, refinedFilter) {
    // this function is used:
    // - when the agent returned zero results, and the user
    //   must change the search
    // - when the agent makes a filter proposal, and the user says no I want something else
    //
    // the refinement is allowed only if at least one parameter is different than before
    // the resulting filter uses all the parameters in ctxFilter that are not mentioned
    // in refinedFilter, as well as all of refinedFilter

    ctxFilter = ctxFilter.optimize();
    refinedFilter = refinedFilter.optimize();

    const ctxSlots = filterToSlots(ctxFilter);
    const refinedSlots = filterToSlots(refinedFilter);
    // all slots in the context must be either not mentioned in the refinement, or changed
    for (let key in ctxSlots) {
        if (refinedSlots[key] && refinedSlots[key].equals(ctxSlots[key]))
            return null;
    }
    // all slots that are in the refinement must be mentioned in the context
    for (let key in refinedSlots) {
        if (!ctxSlots[key])
            return null;
    }

    const ctxClauses = (ctxFilter.isAnd ? ctxFilter.operands : [ctxFilter]).filter((clause) => {
        let good = true;
        clause.visit(new class extends Ast.NodeVisitor {
             visitExternalBooleanExpression() {
                // do not recurse
                // get rid of get-predicates in the context, regardless
                good = false;
                return false;
            }
            visitValue() {
                // do not recurse
                return false;
            }

            visitAtomBooleanExpression(atom) {
                good = good && !C.filterUsesParam(refinedFilter, atom.name);
                return true;
            }
            visitDontCareBooleanExpression(atom) {
                good = good && !C.filterUsesParam(refinedFilter, atom.name);
                return true;
            }
        });
        return good;
    });

    return new Ast.BooleanExpression.And(null, [...ctxClauses, refinedFilter]).optimize();
}

function queryRefinement(ctxTable, newFilter, refineFilter) {
    let ctxFilterTable;
    [ctxTable, ctxFilterTable] = findOrMakeFilterTable(ctxTable);
    //if (ctxFilterTable === null)
    //    return null;
    assert(ctxFilterTable.isFilter && ctxFilterTable.table.isInvocation);

    const refinedFilter = refineFilter(ctxFilterTable.filter, newFilter);
    if (refinedFilter === null)
        return null;

    ctxFilterTable.filter = refinedFilter;
    return ctxTable;
}

function makeSimpleState(ctx, dialogueAct, dialogueActParam) {
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

function isValidSlotFillQuestion(table, question) {
    const arg = table.schema.getArgument(question);
    if (!arg)
        return false;

    return arg.getAnnotation('filterable') !== false;
}

function preciseSearchQuestionAnswer(ctx, [question, answer]) {
    const answerFunctions = C.getFunctionNames(answer);
    assert(answerFunctions.length === 1);
    if (answerFunctions[0] !== ctx.currentFunction)
        return null;
    const currentTable = ctx.current.stmt.table;
    if (isValidSlotFillQuestion(currentTable, question))
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
        sysState = makeSimpleState(ctx, 'sys_generic_search_question', null);
    else
        sysState = makeSimpleState(ctx, 'sys_search_question', question);
    return checkStateIsValid(ctx, sysState, userState);
}

function checkSearchResultPreamble(ctx, base, num, more) {
    if (base !== ctx.currentFunction)
        return null;
    if (num !== null) {
        if (!num.equals(ctx.current.count))
            return null;
        if (more !== ctx.current.more)
            return null;
    }

    return ctx;
}

function checkFilterPairForDisjunctiveQuestion(ctx, f1, f2) {
    if (f1.name !== f2.name)
        return null;
    if (!f1.value.getType().equals(f2.value.getType()))
        return null;
    if (f1.value.equals(f2.value))
        return null;

    let good1 = false;
    let good2 = false;
    for (let result of ctx.results) {
        const value = result.value[f1.name];
        if (!value)
            return null;
        if (value.equals(f1.value))
            good1 = true;
        if (value.equals(f2.value))
            good2 = true;
        if (good1 && good2)
            break;
    }
    if (!good1 || !good2)
        return null;

    return [f1.name, f1.value.getType()];
}

function impreciseSearchQuestionAnswer(ctx, [question, answer]) {
    const currentTable = ctx.current.stmt.table;
    if (isValidSlotFillQuestion(currentTable, question))
        return null;
    if (!C.checkFilter(ctx.current.stmt.table, answer))
        return null;

    const clone = ctx.clone();
    const cloneTable = clone.current.stmt.table;
    const newTable = queryRefinement(cloneTable, answer, refineFilterToAnswerQuestion);
    if (newTable === null)
        return null;
    const userState = overrideCurrentQuery(clone, newTable);
    const sysState = makeSimpleState(ctx, 'sys_search_question', question);
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
        if (C.isSameFunction(nextInvocation.schema, action.schema)) {
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


function addAction(ctxClone, dialogueAct, action, confirm = false) {
    assert(action instanceof Ast.Invocation);
    const state = ctxClone.state;
    state.dialogueAct = dialogueAct;
    state.dialogueActParam = null;

    if (ctxClone.nextInfo) {
        const nextInvocation = getActionInvocation(ctxClone.next);
        if (C.isSameFunction(nextInvocation.schema, action.schema)) {
            ctxClone.next.results = null;
            ctxClone.next.confirm = confirm;
            return state;
        }
    }

    let newStmt = new Ast.Statement.Command(null, null, [new Ast.Action.Invocation(null,
        new Ast.Invocation(null,
            action.selector,
            action.channel,
            [],
            action.schema
        ),
        action.schema
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
        sysState = makeSimpleState(ctx, 'sys_recommend_one', null);
    else
        sysState = addActionParam(ctx.clone(), 'sys_recommend_one', action, findChainParam(topResult, action), topResult.value.id);
    return checkStateIsValid(ctx, sysState, userState);
}

function positiveRecommendationReplyPair(ctx, [topResult, actionProposal, acceptedAction]) {
    // if acceptedAction === null, the user wants to know more about the result before
    // making a decision
    let userState;
    if (acceptedAction === null) {
        userState = makeSimpleState(ctx, 'learn_more', null);
    } else {
        const chainParam = findChainParam(topResult, acceptedAction);
        userState = addActionParam(ctx.clone(), 'execute', acceptedAction, chainParam, topResult.value.id);
    }

    let sysState;
    if (actionProposal === null) {
        sysState = makeSimpleState(ctx, 'sys_recommend_one', null);
    } else {
        const chainParam = findChainParam(topResult, actionProposal);
        sysState = addActionParam(ctx.clone(), 'sys_recommend_one', actionProposal, chainParam, topResult.value.id);
    }
    return checkStateIsValid(ctx, sysState, userState);
}

function addResultQuestion(ctxClone, question) {
    // add a statement between the current result statement and the next statement

    const state = ctxClone.state;
    state.dialogueAct = 'execute';
    state.dialogueActParam = null;

    const newStatement = new Ast.Statement.Command(null, question, [C.notifyAction()]);
    const newItem = new Ast.DialogueHistoryItem(null, newStatement, null, false);

    // remove all intermediate results between the current program and the next one, and add the new item
    if (ctxClone.nextIdx !== null)
        state.history.splice(ctxClone.currentIdx+1, ctxClone.nextIdx-(ctxClone.currentIdx+1), newItem);
    else
        state.history.splice(ctxClone.currentIdx+1, state.history.length-(ctxClone.currentIdx+1), newItem);

    return state;
}

function listProposalSearchQuestionPair(ctx, [results, name, actionProposal, question]) {
    const [qname, qtype] = question;

    if (!ctx.currentFunctionSchema.hasArgument(qname))
        return null;
    if (qtype !== null && !ctx.currentFunctionSchema.getArgType(qname).equals(qtype))
        return null;

    const resultRef = new Ast.Table.ResultRef(null, ctx.currentFunctionSchema.class.name, ctx.currentFunctionSchema.name,
        new Ast.Value.Number(1), ctx.currentFunctionSchema);
    const filterTable = new Ast.Table.Filter(null, resultRef,
        new Ast.BooleanExpression.Atom(null, 'id', '==', name), ctx.currentFunctionSchema);
    const questionTable = C.makeProjection(filterTable, qname);
    const userState = addResultQuestion(ctx.clone(), questionTable);

    let dialogueAct = results.length === 2 ? 'sys_recommend_two' : 'sys_recommend_three';
    let sysState;
    if (actionProposal === null)
        sysState = makeSimpleState(ctx, dialogueAct, null);
    else
        sysState = addAction(ctx.clone(), dialogueAct, actionProposal);

    return checkStateIsValid(ctx, sysState, userState);
}

function recommendationSearchQuestionPair(ctx, [topResult, actionProposal, question]) {
    const [qname, qtype] = question;

    if (!ctx.currentFunctionSchema.hasArgument(qname))
        return null;
    if (qtype !== null && !ctx.currentFunctionSchema.getArgType(qname).equals(qtype))
        return null;

    let sysDialogueAct;
    if (topResult === null) {
        assert(actionProposal === null);
        sysDialogueAct = 'sys_learn_more_what';
        topResult = ctx.results[0];
    } else {
        sysDialogueAct = 'sys_recommend_one';
    }

    const resultRef = new Ast.Table.ResultRef(null, ctx.currentFunctionSchema.class.name, ctx.currentFunctionSchema.name,
        new Ast.Value.Number(1), ctx.currentFunctionSchema);
    const filterTable = new Ast.Table.Filter(null, resultRef,
        new Ast.BooleanExpression.Atom(null, 'id', '==', topResult.value.id), ctx.currentFunctionSchema);
    const questionTable = C.makeProjection(filterTable, qname);
    const userState = addResultQuestion(ctx.clone(), questionTable);

    let sysState;
    if (actionProposal === null) {
        sysState = makeSimpleState(ctx, sysDialogueAct, null);
    } else {
        const chainParam = findChainParam(topResult, actionProposal);
        sysState = addActionParam(ctx.clone(), sysDialogueAct, actionProposal, chainParam, topResult.value.id);
    }

    return checkStateIsValid(ctx, sysState, userState);
}

function negativeListProposalReplyPair(ctx, [results, action, request]) {
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

    let dialogueAct = results.length === 2 ? 'sys_recommend_two' : 'sys_recommend_three';
    let sysState;
    if (action === null)
        sysState = makeSimpleState(ctx, dialogueAct, null);
    else
        sysState = addAction(ctx.clone(), dialogueAct, action);
    return checkStateIsValid(ctx, sysState, userState);
}

function positiveListProposalReplyPair(ctx, [results, actionProposal, name, acceptedAction]) {

    // if actionProposal === null the flow is roughly
    //
    // U: hello i am looking for a restaurant
    // A: how about the ... or the ... ?
    // U: I like the ... bla
    //
    // in this case, the agent should hit the "... is a ... restaurant in the ..."
    // we treat it as "execute" dialogue act and add a filter that causes the program to return a single result

    let userState;
    if (acceptedAction === null) {
        const clone = ctx.clone();
        const cloneTable = clone.current.stmt.table;
        const namefilter = new Ast.BooleanExpression.Atom(null, 'id', '==', name);
        const newTable = queryRefinement(cloneTable, namefilter, (one, two) => new Ast.BooleanExpression.And(null, [one, two]));
        if (newTable === null)
            return null;

        userState = overrideCurrentQuery(clone, newTable);
    } else {
        const chainParam = findChainParam(results[0], acceptedAction);
        userState = addActionParam(ctx.clone(), 'execute', acceptedAction, chainParam, name);
    }

    let dialogueAct = results.length === 2 ? 'sys_recommend_two' : 'sys_recommend_three';
    let sysState;
    if (actionProposal === null)
        sysState = makeSimpleState(ctx, dialogueAct, null);
    else
        sysState = addAction(ctx.clone(), dialogueAct, actionProposal);
    return checkStateIsValid(ctx, sysState, userState);
}

function impreciseSearchQuestionAnswerPair(question, answer) {
    assert(typeof question === 'string');
    if (answer instanceof Ast.BooleanExpression) {
        let pname;
        if (answer.isNot) {
            assert(answer.expr.isAtom || answer.expr.isDontCare);
            pname = answer.expr.name;
        } else {
            assert(answer.isAtom || answer.isDontCare);
            pname = answer.name;
        }
        if (pname !== question)
            return null;

        return [question, answer];
    } else {
        assert(answer instanceof Ast.Value);
        answer = C.makeFilter(new Ast.Value.VarRef(question), '==', answer);
        if (answer === null)
            return null;
        return [question, answer];
    }
}

function emptySearchChangePair(ctx, [question, phrase]) {
    const currentTable = ctx.current.stmt.table;
    if (question !== null && !currentTable.schema.out[question])
        return null;

    const clone = ctx.clone();

    const cloneTable = clone.current.stmt.table;
    const [,ctxFilterTable] = findOrMakeFilterTable(clone.current.stmt.table);
    if (question !== null && !C.filterUsesParam(ctxFilterTable.filter, question))
        return null;

    const newTable = queryRefinement(cloneTable, phrase.filter, refineFilterToChangeFilter);
    if (newTable === null)
        return null;
    const userState = overrideCurrentQuery(clone, newTable);
    const sysState = makeSimpleState(ctx, question ? 'sys_empty_search_question' : 'sys_empty_search', question);
    return checkStateIsValid(ctx, sysState, userState);
}

module.exports = {
    // consistency checks
    POLICY_NAME,
    INITIAL_CONTEXT_INFO,
    checkStateIsValid,

    // system state manipulation
    makeSimpleState,

    // user state manipulation,
    overrideCurrentQuery,

    // helpers
    SlotBag,
    checkAndAddSlot,
    getContextInfo,
    isQueryAnswerValidForQuestion,
    isValidNegativePreambleForInfo,
    isFilterCompatibleWithResult,
    isInfoPhraseCompatibleWithResult,
    checkInfoPhrase,
    checkFilterPairForDisjunctiveQuestion,
    getActionInvocation,

    // system dialogue acts
    checkSearchResultPreamble,
    makeActionRecommendation,
    makeRecommendation,
    checkRecommendation,
    makeShortUserQuestionAnswer,
    checkListProposal,
    checkActionForRecommendation,
    makeRefinementProposal,

    // user dialogue acts
    mergePreambleAndRequest,
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
    positiveRecommendationReplyPair,
    recommendationSearchQuestionPair,
    negativeListProposalReplyPair,
    positiveListProposalReplyPair,
    listProposalSearchQuestionPair,
    emptySearchChangePair
};
