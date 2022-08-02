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

import { Expression, FunctionCallExpression, InvocationExpression } from "thingtalk/dist/ast";
import { GetInvocationExpression } from "../ast_manip";
import { ContextInfo, addNewStatement } from "../state_manip";

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
