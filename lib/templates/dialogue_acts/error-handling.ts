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

// import { Ast } from "thingtalk";
// import assert from "assert";
import { AndBooleanExpression, applyLevenshteinSync, AtomBooleanExpression, DialogueHistoryItem, DialogueState, DontCareBooleanExpression, Expression, FilterExpression,  FunctionCallExpression, InvocationExpression, Levenshtein, levenshteinFindSchema, NotBooleanExpression, ProjectionExpression } from "thingtalk/dist/ast";
import { getInvocationExpression, resolveProjection, FilterSlot } from "../ast_manip";
import { ContextInfo, addNewStatement, addNewItem } from "../state_manip";
import { isSameFunction, ParamSlot } from "../utils";

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
    const invocation : InvocationExpression|FunctionCallExpression = getInvocationExpression(lastExpression);

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
    if (!ctx.current)
        return null;
    if (!ctx.current.levenshtein)
        return null;

    // if the old and new filter are not of the same name, discard
    // TODO: investigate if this is the best approach
    if (oldFilter.toString() !== newFilter.toString())
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
    if (!(oldFilter.ast instanceof AtomBooleanExpression) || !(newFilter.ast instanceof AtomBooleanExpression))
        return null;

    // 5. the filter predicate has the same name as the oldFilter
    if (!oldFilter.ast.equals(expr.filter))
        return null;
    
    // 6. the two filters are from the same schema
    const invocation : Expression = levenshteinFindSchema(ctx.current!.stmt.expression);
    if (!isSameFunction(invocation.schema!, oldFilter.schema) || !isSameFunction(oldFilter.schema, newFilter.schema))
        return null;
    
    // setting delta as "not oldFilter && newFilter"
    const delta = (new Levenshtein(null, new FilterExpression(null, invocation, new AndBooleanExpression(null, [new NotBooleanExpression(null, oldFilter.ast), newFilter.ast]), invocation.schema), "$continue")).optimize();
    
    // getting applied result
    const appliedResult = applyLevenshteinSync(ctx.current!.stmt.expression, delta);
    const resExprStmt = ctx.current!.stmt.clone();
    resExprStmt.expression = appliedResult;

    const res = addNewItem(ctx, "execute", null, "accepted", new DialogueHistoryItem(null, resExprStmt, null, "accepted", delta));
    // console.log(`changeOfMindSimple: pushing levenshtein ${delta.prettyprint()} and applied result ${appliedResult.prettyprint()} to context`);
    return res;
}

export function handleThisNotThatError(ctx : ContextInfo, filters : FilterSlot[]) : DialogueState | null {
    if (filters.length === 2)
        return changeOfMindSimple(ctx, filters[0], filters[1]);
    return null;
}

export function handleNotThatError(ctx : ContextInfo, rejectFilter : FilterSlot) : DialogueState | null {    
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

    // 3. the rejectFilter is an AtomBooleanExpression
    if (!(rejectFilter.ast instanceof AtomBooleanExpression))
        return null;

    // 4. the filter predicate from the previous turn has the same name as the rejectFilter
    if (!rejectFilter.ast.equals(expr.filter))
        return null;

    // 5. the filter is from the same schema
    const invocation : Expression = levenshteinFindSchema(ctx.current!.stmt.expression);
    if (!isSameFunction(invocation.schema!, rejectFilter.schema))
        return null;

    // setting delta as "not rejectFilter"
    const delta = (new Levenshtein(null, new FilterExpression(null, invocation, new NotBooleanExpression(null, rejectFilter.ast), invocation.schema), "$continue")).optimize();

    // getting applied result
    const appliedResult = applyLevenshteinSync(ctx.current!.stmt.expression, delta);
    const resExprStmt = ctx.current!.stmt.clone();
    resExprStmt.expression = appliedResult;

    const res = addNewItem(ctx, "not_that", rejectFilter.ast.name, "accepted", new DialogueHistoryItem(null, resExprStmt, null, "accepted", delta));
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

    // 4. the filter is from the same schema
    const invocation : Expression = levenshteinFindSchema(ctx.current!.stmt.expression);
    if (!isSameFunction(invocation.schema!, dontCareField.schema))
        return null;

    // setting delta as "dont care"
    const delta = (new Levenshtein(null, new FilterExpression(null, invocation, new DontCareBooleanExpression(null, dontCareField.name), invocation.schema), "$continue")).optimize();

    // getting applied result
    const appliedResult = applyLevenshteinSync(ctx.current!.stmt.expression, delta);
    const resExprStmt = ctx.current!.stmt.clone();
    resExprStmt.expression = appliedResult;

    const res = addNewItem(ctx, "execute", null, "accepted", new DialogueHistoryItem(null, resExprStmt, null, "accepted", delta));
    // console.log(`handleDidntAskAboutError: pushing levenshtein ${delta.prettyprint()} and applied result ${appliedResult.prettyprint()} to context`);
    return res;
}

// export function handleNotThatProjError(ctx : ContextInfo, rejection : ParamSlot) : DialogueState | null {
//     // console.log("Entering handleNotThatProjError");

//     // check if this has Levenshtein history, only proceed if it does
//     if (!ctx.current)
//         return null;
//     if (!ctx.current.levenshtein)
//         return null;

//     const lastLevenshtein = ctx.current.levenshtein;

//     // for now, we only proceed if:
//     // 1. last levenshtein contains only only element (a chain with only one element)
//     if (lastLevenshtein.expression.expressions.length !== 1)
//         return null;

//     // const expr = lastLevenshtein.expression.expressions[0];

//     // 2. the last levenshtein is a projection with a rejection mentioned in it
//     // if (!(expr instanceof ProjectionExpression && !expr.args.includes(rejection.name)))
//     //     return null;

//     // TODO: what to do with state?

//     // setting delta as the new replacement
//     const delta = lastLevenshtein.clone();
//     cont newExpression = new Expression
//     const newProjection = new ProjectionExpression(null, /*expression*/, ['undefined_proj'])
//     // expr.args = ['undefined'];

//     // getting applied result
//     const appliedResult = applyLevenshteinExpressionStatement(ctx.current!.stmt, delta);

//     const res = addNewItem(ctx, "not_that", null, "accepted", new DialogueHistoryItem(null, appliedResult, null, "accepted", delta));

//     console.log("handleNotThatProjError Success");

//     return res;
// }

// function to try out doing projections with an expression nonterminal
/*
export function handleNotThatProjExpError(ctx : ContextInfo, that : Expression) : DialogueState | null {
        // check if this has Levenshtein history, only proceed if it does
    // if (!ctx.current)
    //     return null;
    // if (!ctx.current.levenshtein)
    //     return null;

    // const lastLevenshtein = ctx.current.levenshtein;

    // setting delta as the new replacement
    const newProjection = new ProjectionExpression(null, that, ['undefined_proj'], [], [], null);

    const newProjection = makeProjection(that, 'undefined_proj');

    const delta = new Levenshtein(null, newProjection, '');
    // getting applied result
    const appliedResult = applyLevenshteinExpressionStatement(ctx.current!.stmt, delta);

    const res = addNewItem(ctx, "not_that", 'undefined_proj', "accepted", new DialogueHistoryItem(null, appliedResult, null, "accepted", delta));

    return res;

}
*/


export function handleProjectionChange(ctx : ContextInfo, rejection_replacement : ParamSlot[]) : DialogueState | null {
    // check if this has Levenshtein history, only proceed if it does
    if (!ctx.current)
        return null;
    if (!ctx.current.levenshtein)
        return null;

    const rejection = rejection_replacement[0];
    const replacement = rejection_replacement[1];

    const lastLevenshtein = ctx.current.levenshtein;

    // for now, we only proceed if:
    // 1. last levenshtein contains only one element (a chain with only one element)
    if (lastLevenshtein.expression.expressions.length !== 1)
        return null;

    const expr = lastLevenshtein.expression.expressions[0];

    // 2. the last levenshtein is a projection with a rejection mentioned in it
    if (!(expr instanceof ProjectionExpression && expr.args.includes(rejection.name)))
        return null;

    // 3. the two projection statements we are adding are not the same
    if (rejection.name === replacement.name)
        return null;

    // 4. the two names are from the same schema, which is the same as the one before
    const invocation : Expression = levenshteinFindSchema(ctx.current!.stmt.expression); 
    if (!isSameFunction(invocation.schema!, rejection.schema) || !isSameFunction(rejection.schema, replacement.schema))
        return null;

    // setting delta as the new replacement
    const delta : Levenshtein = (new Levenshtein(null, new ProjectionExpression(null, invocation, [replacement.name], [], [], resolveProjection(invocation.schema!, [replacement.name])), "$continue")).optimize();

    // getting applied result
    const appliedResult = applyLevenshteinSync(ctx.current!.stmt.expression, delta);
    const resExprStmt = ctx.current!.stmt.clone();
    resExprStmt.expression = appliedResult;

    const res = addNewItem(ctx, "execute", null, "accepted", new DialogueHistoryItem(null, resExprStmt, null, "accepted", delta));
    // console.log(`Success: pushing levenshtein ${delta.prettyprint()} and applied result ${appliedResult.prettyprint()} to context`);

    return res;
}
