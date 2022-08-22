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
// Authors: Shicheng Liu <shicheng@cs.stanford.edu> and Nathan Marks <nsmarks@stanford.edu>

import assert from "assert";
import { Ast, } from "thingtalk";
import { AndBooleanExpression, applyLevenshteinExpressionStatement, AtomBooleanExpression, DialogueHistoryItem, DialogueState, DontCareBooleanExpression, Expression, FilterExpression , FunctionCallExpression, InvocationExpression, NotBooleanExpression } from "thingtalk/dist/ast";
import { GetInvocationExpression } from "../ast_manip";
import { ContextInfo, addNewStatement, addNewItem } from "../state_manip";
import { ParamSlot } from "../utils";

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

export function changeOfMindSimple(ctx : ContextInfo, oldFilter : Ast.Expression, newFilter : Ast.Expression) : DialogueState | null {
    // check if this has Levenshtein history, only proceed if it does
    if (!ctx.current)
        return null;
    if (!ctx.current.levenshtein)
        return null;

    assert(oldFilter instanceof FilterExpression);
    assert(newFilter instanceof FilterExpression);

    // if the old and new filter are not of the same name, discard
    // TODO: investigate if this is the best approach
    if (oldFilter.expression !== newFilter.expression)
        return null;
    
    const lastLevenshtein = ctx.current.levenshtein;

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
    if (!(oldFilter.filter instanceof AtomBooleanExpression) || !(newFilter.filter instanceof AtomBooleanExpression))
        return null;

    // 5. the filter predicate has the same name as the oldFilter
    if (!oldFilter.filter.equals(expr.filter))
        return null;
    
    // setting delta
    const delta = lastLevenshtein.clone();
    (delta.expression.expressions[0] as FilterExpression).filter = new AndBooleanExpression(null, [new NotBooleanExpression(null, oldFilter.filter), newFilter.filter]);
    
    // getting applied result
    const appliedResult = applyLevenshteinExpressionStatement(ctx.current!.stmt, delta);

    const res = addNewItem(ctx, "execute", null, "accepted", new DialogueHistoryItem(null, appliedResult, null, "accepted", delta));
    // console.log(`changeOfMindSimple: pushing levenshtein ${delta.prettyprint()} and applied result ${appliedResult.prettyprint()} to context`);
    // if (appliedResult.expression.schema === null || appliedResult.expression.first.schema === null) {
    //     console.log(delta.expression.schema);
    //     console.log(lastLevenshtein.expression.schema);
    // }
    return res;
}

export function handleThisNotThatError(ctx : ContextInfo, filters : Ast.Expression[]) : DialogueState | null {
    if (filters.length === 2)
        return changeOfMindSimple(ctx, filters[0], filters[1]);
    return null;
}

export function handleNotThatError(ctx : ContextInfo, rejectFilter : Ast.Expression) : DialogueState | null {    
    // check if this has Levenshtein history, only proceed if it does
    if (!ctx.current)
        return null;
    if (!ctx.current.levenshtein)
        return null;

    assert(rejectFilter instanceof Ast.FilterExpression);
    
    const lastLevenshtein = ctx.current.levenshtein;

    // for now, we only proceed if:
    // 1. last levenshtein contains only only element (a chain with only one element)
    if (lastLevenshtein.expression.expressions.length !== 1)
        return null;
    
    const expr = lastLevenshtein.expression.expressions[0];

    // 2. the last levenshtein is a filter with predicate being an AtomBooleanExpression
    if (!(expr instanceof FilterExpression) || !(expr.filter instanceof AtomBooleanExpression))
        return null;

    // 3. the rejectFilter is an AtomBooleanExpression
    if (!(rejectFilter.filter instanceof AtomBooleanExpression))
        return null;

    // 4. the filter predicate from the previous turn has the same name as the rejectFilter
    if (!rejectFilter.filter.equals(expr.filter))
        return null;

    // setting delta as "not rejectFilter"
    const delta = lastLevenshtein.clone();
    (delta.expression.expressions[0] as FilterExpression).filter = new NotBooleanExpression(null, rejectFilter.filter);

    // getting applied result
    const appliedResult = applyLevenshteinExpressionStatement(ctx.current!.stmt, delta);

    const res = addNewItem(ctx, "execute", null, "accepted", new DialogueHistoryItem(null, appliedResult, null, "accepted", delta));
    // console.log(`handleNotThatError: pushing levenshtein ${delta.prettyprint()} and applied result ${appliedResult.prettyprint()} to context`);
    return res;
}

export function handleDidntAskAboutError(ctx : ContextInfo, dontCareField : ParamSlot) : DialogueState | null {
    // check if this has Levenshtein history, only proceed if it does
    if (!ctx.current)
        return null;
    if (!ctx.current.levenshtein)
        return null;
    
    const lastLevenshtein = ctx.current.levenshtein;

    // for now, we only proceed if:
    // 1. last levenshtein contains only only element (a chain with only one element)
    if (lastLevenshtein.expression.expressions.length !== 1)
        return null;

    const expr = lastLevenshtein.expression.expressions[0];

    // 2. the last levenshtein is a filter with predicate being an AtomBooleanExpression
    if (!(expr instanceof FilterExpression) || !(expr.filter instanceof AtomBooleanExpression))
        return null;

    // 3. the filter field from the previous turn is the same as dontCareField
    if (dontCareField.name !== expr.filter.name)
        return null;

    // setting delta as "dont care"
    const delta = lastLevenshtein.clone();
    (delta.expression.expressions[0] as FilterExpression).filter = new DontCareBooleanExpression(null, dontCareField.name);

    // getting applied result
    const appliedResult = applyLevenshteinExpressionStatement(ctx.current!.stmt, delta);

    const res = addNewItem(ctx, "execute", null, "accepted", new DialogueHistoryItem(null, appliedResult, null, "accepted", delta));
    // console.log(`handleDidntAskAboutError: pushing levenshtein ${delta.prettyprint()} and applied result ${appliedResult.prettyprint()} to context`);
    return res;
}
