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
import * as ThingTalk from 'thingtalk';
import { Ast, Type } from 'thingtalk';
import { SentenceGeneratorTypes } from 'genie-toolkit';
export type AgentReplyRecord = SentenceGeneratorTypes.AgentReplyRecord<Ast.DialogueState>;

import * as C from './ast_manip';
import { isExecutable } from './utils';

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

export const POLICY_NAME = 'org.thingpedia.dialogue.transaction';

const LARGE_RESULT_THRESHOLD = 50;
function isLargeResultSet(result : Ast.DialogueHistoryResultList) : boolean {
    return result.more || !(result.count instanceof Ast.Value.Number) || result.count.value >= LARGE_RESULT_THRESHOLD;
}

function invertDirection(dir : 'asc'|'desc') : 'asc'|'desc' {
    if (dir === 'asc')
        return 'desc';
    else
        return 'asc';
}

function getSortName(value : Ast.Value) : string {
    if (value instanceof Ast.VarRefValue)
        return value.name;
    return C.getScalarExpressionName(value);
}

function getTableArgMinMax(table : Ast.Expression) : [string, string]|null {
    while (table instanceof Ast.ProjectionExpression)
        table = table.expression;

    // either an index of a sort, where the index is exactly 1 or -1
    // or a slice of a sort, with a base of 1 or -1, and a limit of 1
    // (both are equivalent and get normalized, but sometimes we don't run the normalization)
    if (table instanceof Ast.IndexExpression && table.expression instanceof Ast.SortExpression && table.indices.length === 1) {
        const index = table.indices[0];
        if (index instanceof Ast.Value.Number &&
            (index.value === 1 || index.value === -1))
            return [getSortName(table.expression.value), index.value === -1 ? invertDirection(table.expression.direction) : table.expression.direction];
    }

    if (table instanceof Ast.SliceExpression && table.expression instanceof Ast.SortExpression) {
        const { base, limit } = table;
        if (base instanceof Ast.Value.Number && (base.value === 1 || base.value === -1) &&
            limit instanceof Ast.Value.Number && limit.value === 1)
        return [getSortName(table.expression.value), base.value === -1 ? invertDirection(table.expression.direction) : table.expression.direction];
    }

    return null;
}

export class ResultInfo {
    isTable : boolean;
    isQuestion : boolean;
    isAggregation : boolean;
    isList : boolean;
    argMinMaxField : [string, string]|null;
    projection : string[]|null;
    hasError : boolean;
    hasEmptyResult : boolean;
    hasSingleResult : boolean;
    hasLargeResult : boolean;
    idType : Type|null;

    constructor(state : Ast.DialogueState,
                item : Ast.DialogueHistoryItem) {
        assert(item.results !== null);

        const stmt = item.stmt;
        assert(stmt.stream === null);
        this.isTable = stmt.last.schema!.functionType === 'query';

        if (this.isTable) {
            const table = stmt.lastQuery!;
            this.isQuestion = !!(table instanceof Ast.ProjectionExpression
                || table instanceof Ast.IndexExpression
                || table instanceof Ast.AggregationExpression);
            this.isAggregation = table instanceof Ast.AggregationExpression;
            this.isList = table.schema!.is_list;
            this.argMinMaxField = getTableArgMinMax(table);
            assert(this.argMinMaxField === null || this.isQuestion);
            this.projection = table instanceof Ast.ProjectionExpression ?
                C.getProjectionArguments(table) : null;
            if (this.projection)
                this.projection.sort();
        } else {
            this.isQuestion = false;
            this.isAggregation = false;
            this.isList = false;
            this.argMinMaxField = null;
            this.projection = null;
            if (state.dialogueAct === 'action_question')
                this.projection = state.dialogueActParam;
        }
        this.hasError = item.results.error !== null;
        this.hasEmptyResult = item.results.results.length === 0;
        this.hasSingleResult = item.results.results.length === 1;
        this.hasLargeResult = isLargeResultSet(item.results);

        const id = stmt.last.schema!.getArgument('id');
        this.idType = id && !id.is_input ? id.type : null;
    }
}

export class NextStatementInfo {
    isAction : boolean;
    chainParameter : string|null;
    chainParameterFilled : boolean;
    isComplete : boolean;

    constructor(currentItem : Ast.DialogueHistoryItem|null,
                resultInfo : ResultInfo|null,
                nextItem : Ast.DialogueHistoryItem) {
        const nextstmt = nextItem.stmt;

        this.isAction = !nextstmt.lastQuery;

        this.chainParameter = null;
        this.chainParameterFilled = false;
        this.isComplete = isExecutable(nextstmt);

        if (!this.isAction)
            return;

        assert(nextItem.stmt.expression.expressions.length === 1);
        const action = nextItem.stmt.first;
        assert(action instanceof Ast.InvocationExpression);

        if (!currentItem || !resultInfo || !resultInfo.isTable)
            return;

        const currentstmt = currentItem.stmt;
        const tableschema = currentstmt.expression.schema!;
        const idType = tableschema.getArgType('id');
        if (!idType)
            return;

        const invocation = action.invocation;
        const actionschema = invocation.schema!;
        for (const arg of actionschema.iterateArguments()) {
            if (!arg.is_input)
                continue;
            if (arg.type.equals(idType)) {
                this.chainParameter = arg.name;
                break;
            }
        }

        if (this.chainParameter === null)
            return;

        for (const in_param of invocation.in_params) {
            if (in_param.name === this.chainParameter && !in_param.value.isUndefined) {
                this.chainParameterFilled = true;
                break;
            }
        }
    }
}

function toID(value : Ast.Value|undefined) {
    if (value === undefined)
        return null;
    const jsValue = value.toJS();
    if (typeof jsValue === 'number')
        return jsValue;
    else if (jsValue === null || jsValue === undefined)
        return null;
    else
        return String(jsValue);
}

export class ContextInfo {
    contextTable : SentenceGeneratorTypes.ContextTable;

    state : Ast.DialogueState;
    currentFunction : Ast.FunctionDef|null;
    currentTableFunction : Ast.FunctionDef|null;
    resultInfo : ResultInfo|null;
    isMultiDomain : boolean;
    previousDomainIdx : number|null;
    currentIdx : number|null;
    nextFunction : Ast.FunctionDef|null;
    nextIdx : number|null;
    nextInfo : NextStatementInfo|null;
    aux : any;

    key : {
        currentFunction : string|null;
        nextFunction : string|null;
        currentTableFunction : string|null;

        // type of ID parameter of current result
        // this is usually the same as currentFunction, but can be null
        // the current function doesn't return an ID, and can be different
        // if the current function is not the primary query for this ID type
        // it is used to match names and contexts
        idType : Type|null;

        // IDs of the top 3 results (entity values or numeric IDs)
        id0 : string|number|null;
        id1 : string|number|null;
        id2 : string|number|null;

        // number of results
        resultLength : number;
    };

    constructor(contextTable : SentenceGeneratorTypes.ContextTable,
                state : Ast.DialogueState,
                currentTableSchema : Ast.FunctionDef|null,
                currentFunctionSchema : Ast.FunctionDef|null,
                resultInfo : ResultInfo|null,
                previousDomainIdx : number|null,
                currentIdx : number|null,
                nextIdx : number|null,
                nextFunctionSchema : Ast.FunctionDef|null,
                nextInfo : NextStatementInfo|null,
                aux : any = null) {
        this.contextTable = contextTable;
        this.state = state;

        assert(currentFunctionSchema === null || currentFunctionSchema instanceof Ast.FunctionDef);
        this.currentFunction = currentFunctionSchema;
        assert(currentTableSchema === null || currentTableSchema instanceof Ast.FunctionDef);
        this.currentTableFunction = currentTableSchema;

        this.resultInfo = resultInfo;
        this.isMultiDomain = previousDomainIdx !== null;
        this.previousDomainIdx = previousDomainIdx;
        this.currentIdx = currentIdx;

        assert(nextFunctionSchema === null || nextFunctionSchema instanceof Ast.FunctionDef);
        this.nextFunction = nextFunctionSchema;
        this.nextIdx = nextIdx;
        this.nextInfo = nextInfo;
        this.aux = aux;

        this.key = {
            currentFunction: this.currentFunction ? this.currentFunction.qualifiedName : null,
            nextFunction: this.nextFunction ? this.nextFunction.qualifiedName : null,
            currentTableFunction: this.currentTableFunction ? this.currentTableFunction.qualifiedName : null,

            idType: null,
            id0: null,
            id1: null,
            id2: null,
            resultLength: 0
        };
        if (this.resultInfo) {
            this.key.idType = this.resultInfo.idType;

            const results = this.results!;
            this.key.resultLength = results.length;
            if (results.length > 0)
                this.key.id0 = toID(results[0].value.id);
            if (results.length > 1)
                this.key.id1 = toID(results[1].value.id);
            if (results.length > 2)
                this.key.id2 = toID(results[2].value.id);
        }
    }

    toString() : string {
        return `ContextInfo(${this.state.prettyprint()})`;
    }

    get results() {
        if (this.currentIdx !== null)
            return this.state.history[this.currentIdx].results!.results;
        return null;
    }

    get error() {
        if (this.currentIdx !== null)
            return this.state.history[this.currentIdx].results!.error;
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
        return new ContextInfo(
            this.contextTable,
            this.state.clone(),
            this.currentTableFunction,
            this.currentFunction,
            this.resultInfo,
            this.previousDomainIdx, this.currentIdx,
            this.nextIdx, this.nextFunction, this.nextInfo,
            this.aux
        );
    }
}

export function contextKeyFn(ctx : ContextInfo) {
    return ctx.key;
}

export function initialContextInfo(contextTable : SentenceGeneratorTypes.ContextTable) {
    return new ContextInfo(contextTable,
        new Ast.DialogueState(null, POLICY_NAME, 'sys_init', [], []),
        null, null, null, null, null, null, null, null);
}

export function getContextInfo(state : Ast.DialogueState, contextTable : SentenceGeneratorTypes.ContextTable) : ContextInfo {
    let nextItemIdx = null, nextInfo = null, currentFunction = null, currentTableFunction = null,
        nextFunction = null, currentDevice = null, currentResultInfo = null,
        previousDomainItemIdx = null, currentItemIdx = null;
    let proposedSkip = 0;
    for (let idx = 0; idx < state.history.length; idx ++) {
        const item = state.history[idx];
        const functions = C.getFunctions(item.stmt);
        const device = functions[functions.length-1].class!.name;
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
            nextInfo = new NextStatementInfo(
                currentItemIdx !== null ? state.history[currentItemIdx] : null,
                currentResultInfo, item);
            break;
        }

        // proposed items must come after the current item
        // (but they can come before or after the next item, depending on what we're proposing)
        assert(proposedSkip === 0);

        currentDevice = device;
        currentFunction = functions[functions.length-1];

        const stmt = item.stmt;
        const lastQuery = stmt.lastQuery;
        if (lastQuery) {
            const tablefunctions = C.getFunctions(lastQuery);
            currentTableFunction = tablefunctions[tablefunctions.length-1];
        }
        currentItemIdx = idx;
        currentResultInfo = new ResultInfo(state, item);
    }
    if (nextItemIdx !== null)
        assert(nextInfo);
    if (nextItemIdx !== null && currentItemIdx !== null)
        assert(nextItemIdx === currentItemIdx + 1 + proposedSkip);
    if (previousDomainItemIdx !== null)
        assert(currentItemIdx !== null && previousDomainItemIdx <= currentItemIdx);

    return new ContextInfo(contextTable, state, currentTableFunction, currentFunction, currentResultInfo,
        previousDomainItemIdx, currentItemIdx, nextItemIdx, nextFunction, nextInfo);
}

export function isUserAskingResultQuestion(ctx : ContextInfo) : boolean {
    // is the user asking a question about the result (or a specific element), or refining a search?
    // we say it's a question if the user is asking a projection question, and it's not the first turn,
    // and the projection was different at the previous turn
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

    if (ctx.currentIdx === 0) {
        const filterTable = C.findFilterExpression(currentStmt.expression);
        if (!filterTable)
            return false;
        return C.filterUsesParam(filterTable.filter, 'id');
    }

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

function addNewItem(ctx : ContextInfo,
                    dialogueAct : string,
                    dialogueActParam : string|null,
                    confirm : 'accepted'|'proposed'|'confirmed',
                    ...newHistoryItem : Ast.DialogueHistoryItem[]) : Ast.DialogueState {
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

function makeSimpleState(ctx : ContextInfo,
                         dialogueAct : string,
                         dialogueActParam : string[]|null) : Ast.DialogueState {
    // a "simple state" carries the current executed/confirmed/accepted items, but not the
    // proposed ones

    const newState = new Ast.DialogueState(null, POLICY_NAME, dialogueAct, dialogueActParam, []);
    for (let i = 0; i < ctx.state.history.length; i++) {
        if (ctx.state.history[i].confirm === 'proposed')
            break;
        newState.history.push(ctx.state.history[i]);
    }

    return newState;
}

function sortByName(p1 : Ast.InputParam, p2 : Ast.InputParam) : -1|0|1 {
    if (p1.name < p2.name)
        return -1;
    if (p1.name > p2.name)
        return 1;
    return 0;
}

function setOrAddInvocationParam(newInvocation : Ast.Invocation,
                                 pname : string,
                                 value : Ast.Value) : void {
    let found = false;
    for (const in_param of newInvocation.in_params) {
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

function mergeParameters(toInvocation : Ast.Invocation,
                         fromInvocation : Ast.Invocation) : Ast.Invocation {
    for (const in_param of fromInvocation.in_params) {
        if (in_param.value.isUndefined)
            continue;
        setOrAddInvocationParam(toInvocation, in_param.name, in_param.value);
    }

    return toInvocation;
}

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
            //   addNewItem() will add at the end, after the currently accepted
            //   item, and we'll have two actions (one "accepted" and one "proposed"), or just one "proposed" action
            // if confirm == "accepted":
            //   addNewItem() will wipe everything and we'll only one

            newHistoryItem = next.clone();
            const newInvocation = C.getInvocation(newHistoryItem);
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
        const newStmt = new Ast.ExpressionStatement(null, new Ast.InvocationExpression(null,
            newInvocation, schema.removeArgument(pname)
        ));
        newHistoryItem = new Ast.DialogueHistoryItem(null, newStmt, null, confirm);
    }

    return addNewItem(ctx, dialogueAct, null, confirm, newHistoryItem);
}

function replaceAction(ctx : ContextInfo,
                       dialogueAct : string,
                       action : Ast.Invocation,
                       confirm : 'accepted' | 'proposed' | 'confirmed') : Ast.DialogueState {
    const newStmt = new Ast.ExpressionStatement(null, new Ast.InvocationExpression(null, action, action.schema));
    const newHistoryItem = new Ast.DialogueHistoryItem(null, newStmt, null, confirm);

    return addNewItem(ctx, dialogueAct, null, confirm, newHistoryItem);
}

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
                return new Ast.DialogueState(null, POLICY_NAME, dialogueAct, null, ctx.state.history);

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

    return addNewItem(ctx, dialogueAct, null, confirm, newHistoryItem);
}

function addQuery(ctx : ContextInfo,
                  dialogueAct : string,
                  newTable : Ast.Expression,
                  confirm : 'accepted' | 'proposed') : Ast.DialogueState {
    newTable = C.adjustDefaultParameters(newTable);
    const newStmt = new Ast.ExpressionStatement(null, newTable);
    const newHistoryItem = new Ast.DialogueHistoryItem(null, newStmt, null, confirm);

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

    return addNewItem(ctx, dialogueAct, null, confirm, newTableHistoryItem, newActionHistoryItem);
}

export function makeContextPhrase(symbol : number, value : ContextInfo, utterance = '', priority = 0) : SentenceGeneratorTypes.ContextPhrase {
    return { symbol, utterance, value, priority, key: value.key };
}

export interface AgentReplyOptions {
    end ?: boolean;
    raw ?: boolean;
    numResults ?: number;
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
function makeAgentReply(ctx : ContextInfo,
                        state : Ast.DialogueState,
                        aux : unknown = null,
                        expectedType : ThingTalk.Type|null = null,
                        options : AgentReplyOptions = {}) : AgentReplyRecord {
    const contextTable = ctx.contextTable;

    assert(state instanceof Ast.DialogueState);
    assert(state.dialogueAct.startsWith('sys_'));
    assert(expectedType === null || expectedType instanceof ThingTalk.Type);

    const newContext = getContextInfo(state, contextTable);
    // set the auxiliary information, which is used by the semantic functions of the user
    // to see if the continuation is compatible with the specific reply from the agent
    newContext.aux = aux;

    let mainTag;
    if (state.dialogueAct === 'sys_generic_search_question')
        mainTag = contextTable.ctx_sys_search_question;
    else if (state.dialogueAct.endsWith('_question') && state.dialogueAct !== 'sys_search_question')
        mainTag = contextTable['ctx_' + state.dialogueAct.substring(0, state.dialogueAct.length - '_question'.length)];
    else if (state.dialogueAct.startsWith('sys_recommend_') && state.dialogueAct !== 'sys_recommend_one')
        mainTag = contextTable.ctx_sys_recommend_many;
    else
        mainTag = contextTable['ctx_' + state.dialogueAct];

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
        contextPhrases: [
            makeContextPhrase(ctx.contextTable.ctx_sys_any, newContext),
            makeContextPhrase(mainTag, newContext),
            ...getContextPhrases(newContext)
        ],
        expect: expectedType,

        end: end,
        // if true, enter raw mode for this user's turn
        // (this is used for slot filling free-form strings)
        raw: !!options.raw,

        // the number of results we're describing at this turn
        // (this affects the number of result cards to show)
        numResults: options.numResults || 0,
    };
}

function setEndBit(reply : AgentReplyRecord, value : boolean) : AgentReplyRecord {
    const newReply = {} as AgentReplyRecord;
    Object.assign(newReply, reply);
    newReply.end = value;
    return newReply;
}

function actionShouldHaveResult(ctx : ContextInfo) : boolean {
    const schema = ctx.currentFunction!;
    return Object.keys(schema.out).length > 0;
}

export function tagContextForAgent(ctx : ContextInfo) : number[] {
    const contextTable = ctx.contextTable;

    switch (ctx.state.dialogueAct){
    case 'end':
        // no continuations are possible after explicit "end" (which means the user said
        // "no thanks" after the agent asked "is there anything else I can do for you")
        // but we still tag the context to generate something in inference mode
        return [contextTable.ctx_end];

    case 'greet':
        assert(ctx.state.history.length === 0, `expected empty history for greet`);
        return [contextTable.ctx_greet];

    case 'reinit':
        return [contextTable.ctx_reinit];

    case 'cancel':
        return [contextTable.ctx_cancel];

    case 'action_question':
        return [contextTable.ctx_completed_action_success];

    case 'learn_more':
        assert(ctx.results);
        return [contextTable.ctx_learn_more];

    case 'execute':
    case 'ask_recommend':
        if (ctx.nextInfo !== null) {
            // we have an action we want to execute, or a query that needs confirmation
            if (ctx.nextInfo.chainParameter === null || ctx.nextInfo.chainParameterFilled) {
                // we don't need to fill any parameter from the current query

                if (ctx.nextInfo.isComplete)
                    return [contextTable.ctx_confirm_action];
                else
                    return [contextTable.ctx_incomplete_action_after_search];
            }
        }

        // we must have a result
        assert(ctx.resultInfo, `expected result info`);
        if (!ctx.resultInfo.isTable) {
            if (ctx.resultInfo.hasError)
                return [contextTable.ctx_completed_action_error];
            else if (ctx.resultInfo.hasEmptyResult && actionShouldHaveResult(ctx))
                return [contextTable.ctx_empty_search_command];
            else
                return [contextTable.ctx_completed_action_success];
        }

        if (ctx.resultInfo.hasEmptyResult) {
            // note: aggregation cannot be empty (it would be zero)
            return [contextTable.ctx_empty_search_command];
        }

        if (!ctx.resultInfo.isList) {
            return [contextTable.ctx_display_nonlist_result];
        } else if (ctx.resultInfo.isQuestion) {
            if (ctx.resultInfo.isAggregation) {
                // "how many restaurants nearby have more than 500 reviews?"
                return [contextTable.ctx_aggregation_question];
            } else if (ctx.resultInfo.argMinMaxField !== null) {
                // these are treated as single result questions, but
                // the context is tagged as ctx_with_result_argminmax instead of
                // ctx_with_result_noquestion
                // so the answer is worded differently
                return [contextTable.ctx_single_result_search_command, contextTable.ctx_complete_search_command];
            } else if (ctx.resultInfo.hasSingleResult) {
                // "what is the rating of Terun?"
                // FIXME if we want to answer differently, we need to change this one
                return [contextTable.ctx_single_result_search_command, contextTable.ctx_complete_search_command];
            } else if (ctx.resultInfo.hasLargeResult) {
                // "what's the food and price range of restaurants nearby?"
                // we treat these the same as "find restaurants nearby", but we make sure
                // that the necessary fields are computed
                return [contextTable.ctx_search_command, contextTable.ctx_complete_search_command];
            } else {
                // "what's the food and price range of restaurants nearby?"
                // we treat these the same as "find restaurants nearby", but we make sure
                // that the necessary fields are computed
                return [contextTable.ctx_complete_search_command];
            }
        } else {
            if (ctx.resultInfo.hasSingleResult) // we can recommend
                return [contextTable.ctx_single_result_search_command, contextTable.ctx_complete_search_command];
            else if (ctx.resultInfo.hasLargeResult && ctx.state.dialogueAct !== 'ask_recommend') // we can refine
                return [contextTable.ctx_search_command, contextTable.ctx_complete_search_command];
            else
                return [contextTable.ctx_complete_search_command];
        }

    default:
        throw new Error(`Unexpected user dialogue act ${ctx.state.dialogueAct}`);
    }
}

function ctxCanHaveRelatedQuestion(ctx : ContextInfo) : boolean {
    const currentStmt = ctx.current!.stmt;
    assert(currentStmt.stream === null);
    const currentTable = currentStmt.lastQuery;
    if (!currentTable)
        return false;
    if (!(currentTable.schema instanceof Ast.FunctionDef)) // FIXME ExpressionSignature that is not a FunctionDef - not sure how it happens...
        return false;
    const related = currentTable.schema.getAnnotation<string[]>('related');
    return !!(related && related.length);
}

export function getContextPhrases(ctx : ContextInfo) : SentenceGeneratorTypes.ContextPhrase[] {
    const contextTable = ctx.contextTable;

    const phrases : SentenceGeneratorTypes.ContextPhrase[] = [];
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
    if (!ctx.resultInfo || ctx.resultInfo.hasEmptyResult)
        return phrases;

    assert(ctx.results && ctx.results.length > 0);
    phrases.push(makeContextPhrase(contextTable.ctx_with_result, ctx));
    if (ctx.resultInfo.isTable)
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
        else
            phrases.push(makeContextPhrase(contextTable.ctx_with_result_noquestion, ctx));
        if (ctx.nextInfo)
            phrases.push(makeContextPhrase(contextTable.ctx_with_result_and_action, ctx));

        if (ctx.resultInfo.projection === null)
            phrases.push(makeContextPhrase(contextTable.ctx_without_projection, ctx));
    }
    return phrases;
}

export {
    makeAgentReply,
    setEndBit,

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
