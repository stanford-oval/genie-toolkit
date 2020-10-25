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


import * as C from '../ast_manip';

import {
    makeAgentReply,
    makeSimpleState,
} from '../state_manip';

function makeCountAggregationReplySuffix(ctx, table, mustFilter) {
    if (!ctx.resultInfo.isAggregation)
        return null;
    if (ctx.results.length !== 1 || !ctx.results[0].value.count)
        return null;
    const currentTable = ctx.current.stmt.table;
    if (currentTable.operator !== 'count' || currentTable.field !== '*')
        return null;
    if (!C.isSameFunction(table.schema, ctx.currentTableSchema))
        return null;
    if (mustFilter && !table.isFilter)
        return null;
    if (table.isFilter) {
        const filterTable = C.findFilterTable(currentTable);
        if (!filterTable)
            return null;
        if (!table.filter.equals(filterTable.filter))
            return null;
    }
    return ctx;
}

function makeCountAggregationReply(ctx, num) {
    const count = ctx.results[0].value.count;
    if (!count.equals(num))
        return null;
    return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_display_result', null));
}

function makeOtherAggregationReply(ctx, op, param, value) {
    if (!ctx.resultInfo.isAggregation)
        return null;
    if (ctx.results.length !== 1 || !ctx.results[0].value[param.name])
        return null;
    const currentTable = ctx.current.stmt.table;
    if (currentTable.operator !== op || currentTable.field !== param.name)
        return null;
    if (!value.equals(ctx.results[0].value[param.name]))
        return null;
    return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_display_result', null));
}

export {
    makeCountAggregationReplySuffix,
    makeCountAggregationReply,
    makeOtherAggregationReply
};
