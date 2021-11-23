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
import { Ast, } from 'thingtalk';

import * as C from '../../templates/ast_manip';
import { DialogueInterface } from '../../thingtalk-dialogues';
import { StateM } from '../../utils/thingtalk';

import { ContextInfo } from '../context-info';
import { POLICY_NAME } from '../metadata';
import {
    makeAgentReply,
} from './common';
import * as Templates from '../templates/index.genie.out';

export function makeCountAggregationReply(ctx : ContextInfo, table : Ast.Expression, mustFilter : boolean) {
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
    if (!C.isSameFunction(table.schema!, ctx.currentTableFunction!))
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

    return makeAgentReply(ctx, StateM.makeSimpleState(ctx.state, POLICY_NAME, 'sys_display_result'));
}

export function makeOtherAggregationReply(ctx : ContextInfo, op : string, param : C.ParamSlot, value : Ast.Value) {
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
    return makeAgentReply(ctx, StateM.makeSimpleState(ctx.state, POLICY_NAME, 'sys_display_result'));
}

export function ctxAggregationQuestion(dlg : DialogueInterface, ctx : ContextInfo) {
    const currentStmt = ctx.current!.stmt;
    const currentTable = currentStmt.lastQuery!;
    assert(currentTable instanceof Ast.AggregationExpression);

    if (currentTable.operator === 'count' && currentTable.field === '*')
        dlg.say(Templates.count_aggregation_reply, (reply) => reply);
    else
        dlg.say(Templates.other_aggregation_reply, (reply) => reply);
    return dlg.flush();
}
