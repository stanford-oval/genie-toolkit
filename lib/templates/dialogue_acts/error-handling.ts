// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2022 The Board of Trustees of the Leland Stanford Junior University
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
// Author: Shicheng Liu <shicheng@cs.stanford.edu>

import { applyLevenshteinExpressionStatement, AtomBooleanExpression, DialogueHistoryItem, DialogueState, Expression, FilterExpression, FunctionCallExpression, InvocationExpression } from "thingtalk/dist/ast";
import { GetInvocationExpression, FilterSlot } from "../ast_manip";
import { ContextInfo, addNewStatement, addNewItem } from "../state_manip";

export function handleGenericError(ctx : ContextInfo) {
    // NOTE: This is a temporary, naive solution. More coming after Levenshtein apply is done
    // Creates a query with the same table as the last one, but with no fields
    // This will automatically restart the slot filling assuming that the query is correct.
    
    // If the context does not contain any DialogueHistoryItem, return NULL
    // TODO: maybe revise this
    if (!ctx.current)
        return null;

    // last expression, or in case of a chain expression, the first in the chain
    const lastExpression : Expression =  ctx.current!.stmt.expression.expressions[0];

    // the invocation call hidden in this expression
    const invocation : InvocationExpression|FunctionCallExpression = GetInvocationExpression(lastExpression);

    if (!invocation)
        return null;

    // REVIEW: we may not need all these copying. Investigate further later
    const newCtx = ctx.clone();

    if (invocation instanceof InvocationExpression) {
        const invocationCopy = invocation.clone();
        invocationCopy.invocation.in_params = [];
        return addNewStatement(newCtx, 'execute', null, 'accepted', invocationCopy);
    }
    
    if (invocation instanceof FunctionCallExpression) {
        const invocationCopy = invocation.clone();
        invocationCopy.in_params = [];
        return addNewStatement(newCtx, 'execute', null, 'accepted', invocationCopy);
    }
    
    return addNewStatement(newCtx, 'sys_slot_fill', 'query', 'accepted', invocation);
}

export function changeOfMindSimple(ctx : ContextInfo, oldFilter : FilterSlot, newFilter : FilterSlot) : DialogueState | null {
    // check if this has Levenshtein history, only proceed if it does
    if (ctx.state.historyLevenshtein.length <= 0)
        return null;
    
    // if the old and new filter are not of the same name, discard
    // TODO: investigate if this is the best approach
    if (oldFilter.toString() !== newFilter.toString())
        return null;
    
    const lastLevenshtein = ctx.state.historyLevenshtein[ctx.state.historyLevenshtein.length -1];

    // for now, we only proceed if:
    // 1. last levenshtein contains only only element (a chain with only one element)
    if (lastLevenshtein.expression.expressions.length !== 1)
        return null;

    const expr = lastLevenshtein.expression.expressions[0];
    // 2. the last levenshtein is a filter with predicate being an AtomBooleanExpression
    if (!(expr instanceof FilterExpression) || !(expr.filter instanceof AtomBooleanExpression))
        return null;
    
    // 3. the oldFilter is an AtomBooleanExpression
    // 4. the newFilter is an AtomBooleanExpression
    if (!(oldFilter.ast instanceof AtomBooleanExpression) || !(newFilter.ast instanceof AtomBooleanExpression))
        return null;

    // 5. the filter predicate has the same name as the oldFilter
    if (oldFilter.ast.name !== expr.filter.name)
        return null;
    
    // setting delta
    const delta = lastLevenshtein.clone();
    (delta.expression.expressions[0] as FilterExpression).filter = newFilter.ast;
    
    // getting applied result
    const appliedResult = applyLevenshteinExpressionStatement(ctx.current!.stmt, delta);

    const res = addNewItem(ctx, "execute", null, "accepted", new DialogueHistoryItem(null, appliedResult, null, "accepted"));
    // console.log(`changeOfMindSimple: pushing levenshtein ${delta.prettyprint()} and applied result ${appliedResult.prettyprint()} to context`);
    res.historyAppliedLevenshtein.push(delta);
    res.historyLevenshtein.push(delta);
    return res;
}