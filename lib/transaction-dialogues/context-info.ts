
// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020-2021 The Board of Trustees of the Leland Stanford Junior University
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
import { Ast, Type } from 'thingtalk';

import * as C from '../templates/ast_manip';

import { POLICY_NAME } from './metadata';

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
    hasStream : boolean;
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
        this.hasStream = stmt.stream !== null;

        this.isTable = stmt.last.schema!.functionType === 'query' &&
            (!this.hasStream || state.dialogueAct === 'notification');

        if (this.isTable) {
            const table = stmt.lastQuery!;
            this.isQuestion = !!(table instanceof Ast.ProjectionExpression
                || table instanceof Ast.IndexExpression
                || table instanceof Ast.AggregationExpression);
            this.isAggregation = table instanceof Ast.AggregationExpression;
            this.isList = stmt.expression.schema!.is_list;
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
                this.projection = state.dialogueActParam as string[];
        }
        this.hasError = item.results.error !== null;
        this.hasEmptyResult = !this.hasStream && item.results.results.length === 0;
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
    missingSlots : Ast.AbstractSlot[];

    constructor(currentItem : Ast.DialogueHistoryItem|null,
                resultInfo : ResultInfo|null,
                nextItem : Ast.DialogueHistoryItem) {
        const nextstmt = nextItem.stmt;

        this.isAction = !nextstmt.lastQuery;

        this.chainParameter = null;
        this.chainParameterFilled = false;
        this.isComplete = nextItem.isExecutable();
        this.missingSlots = [];

        for (const slot of nextItem.iterateSlots2()) {
            if (slot instanceof Ast.DeviceSelector)
                continue;
            if (slot.get() instanceof Ast.UndefinedValue)
                this.missingSlots.push(slot);
        }

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

/**
 * This class contains additional information about the current dialogue state
 * that is specific to the transaction dialogues.
 *
 * All the information is already contained in the state itself, but this
 * class makes it faster and more convenient to access.
 *
 * It should not be used outside of the transaction dialogues.
 */
export class ContextInfo {
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

        // aggregation result (for count)
        aggregationCount : number|null;

        is_monitorable : boolean;
    };

    private constructor(state : Ast.DialogueState,
                        currentTableSchema : Ast.FunctionDef|null,
                        currentFunctionSchema : Ast.FunctionDef|null,
                        resultInfo : ResultInfo|null,
                        previousDomainIdx : number|null,
                        currentIdx : number|null,
                        nextIdx : number|null,
                        nextFunctionSchema : Ast.FunctionDef|null,
                        nextInfo : NextStatementInfo|null,
                        aux : any = null) {
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
            resultLength: 0,

            aggregationCount: null,

            is_monitorable: this.currentFunction ? this.currentFunction.is_monitorable : false
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

            if (this.resultInfo.isAggregation) {
                const count = results[0].value.count;
                if (count)
                    this.key.aggregationCount = count.toJS() as number;
            }
        }
    }

    static initial() {
        return new ContextInfo(new Ast.DialogueState(null, POLICY_NAME, 'sys_init', [], []),
            null, null, null, null, null, null, null, null);
    }

    private static _cache = new WeakMap<Ast.DialogueState, ContextInfo>();

    static get(state : Ast.DialogueState|null) : ContextInfo {
        if (state === null)
            return this.initial();
        const cached = this._cache.get(state);
        if (cached)
            return cached;

        let nextItemIdx = null, nextInfo = null, currentFunction = null, currentTableFunction = null,
            nextFunction = null, currentDevice = null, currentResultInfo = null,
            previousDomainItemIdx = null, currentItemIdx = null;
        let proposedSkip = 0;
        for (let idx = 0; idx < state.history.length; idx ++) {
            const item = state.history[idx];
            const itemschema = item.stmt.expression.schema!;
            const device = itemschema.class ? itemschema.class.name : null;
            if (currentDevice && device && device !== currentDevice)
                previousDomainItemIdx = currentItemIdx;
            if (item.confirm === 'proposed') {
                proposedSkip ++;
                continue;
            }
            if (item.results === null) {
                nextItemIdx = idx;
                nextFunction = itemschema;
                nextInfo = new NextStatementInfo(
                    currentItemIdx !== null ? state.history[currentItemIdx] : null,
                    currentResultInfo, item);
                break;
            }

            // proposed items must come after the current item
            // (but they can come before or after the next item, depending on what we're proposing)
            assert(proposedSkip === 0);

            currentDevice = device;
            currentFunction = itemschema;

            const stmt = item.stmt;
            const lastQuery = stmt.lastQuery;
            if (lastQuery)
                currentTableFunction = lastQuery.schema;
            currentItemIdx = idx;
            currentResultInfo = new ResultInfo(state, item);
        }
        if (nextItemIdx !== null)
            assert(nextInfo);
        if (nextItemIdx !== null && currentItemIdx !== null)
            assert(nextItemIdx === currentItemIdx + 1 + proposedSkip);
        if (previousDomainItemIdx !== null)
            assert(currentItemIdx !== null && previousDomainItemIdx <= currentItemIdx);

        const newCtx = new ContextInfo(state, currentTableFunction, currentFunction, currentResultInfo,
            previousDomainItemIdx, currentItemIdx, nextItemIdx, nextFunction, nextInfo);
        this._cache.set(state, newCtx);
        return newCtx;
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
