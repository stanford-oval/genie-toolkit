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

import { Ast, } from 'thingtalk';

import * as C from '../ast_manip';

import {
    ContextInfo,
    makeAgentReply,
    makeSimpleState,
} from '../state_manip';

function makeCountAggregationReplySuffix(ctx : ContextInfo, table : Ast.Expression, mustFilter : boolean) {
    if (!ctx.resultInfo!.isAggregation)
        return null;
    const results = ctx.results;
    if (!results || results.length !== 1 || !results[0].value.count)
        return null;

    const currentStmt = ctx.current!.stmt;
    const currentTable = currentStmt.lastQuery!;
    if (!(currentTable instanceof Ast.AggregationExpression) ||
        currentTable.operator !== 'count' || currentTable.field !== '*')
        return null;
    if (!C.isSameFunction(table.schema!, ctx.currentTableSchema!))
        return null;
    if (mustFilter && !(table instanceof Ast.FilterExpression))
        return null;
    if (table instanceof Ast.FilterExpression) {
        const filterTable = C.findFilterExpression(currentTable);
        if (!filterTable)
            return null;
        if (!table.filter.equals(filterTable.filter))
            return null;
    }
    return ctx;
}

function makeCountAggregationReply(ctx : ContextInfo, num : Ast.Value) {
    const count = ctx.results![0].value.count;
    if (!count.equals(num))
        return null;
    return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_display_result', null));
}

function makeOtherAggregationReply(ctx : ContextInfo, op : string, param : C.ParamSlot, value : Ast.Value) {
    if (!ctx.resultInfo!.isAggregation)
        return null;
    const results = ctx.results;
    if (!results || results.length !== 1 || !results[0].value[param.name])
        return null;
    const currentStmt = ctx.current!.stmt;
    const currentTable = currentStmt.lastQuery!;
    if (!(currentTable instanceof Ast.AggregationExpression) ||
        currentTable.operator !== op ||
        !C.isSameFunction(currentTable.schema!, param.schema) ||
        currentTable.field !== param.name)
        return null;
    if (!value.equals(results[0].value[param.name]))
        return null;
    return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_display_result', null));
}

export {
    makeCountAggregationReplySuffix,
    makeCountAggregationReply,
    makeOtherAggregationReply
};
