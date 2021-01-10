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

import * as C from '../ast_manip';

import {
    ContextInfo,
    addQuery,
} from '../state_manip';
import {
    findOrMakeFilterExpression,
    refineFilterToAnswerQuestion,
} from './refinement-helpers';

function relatedQuestion(ctx : ContextInfo, stmt : Ast.ExpressionStatement) {
    const currentStmt = ctx.current!.stmt;
    const currentTable = currentStmt.expression;

    if (stmt.last.schema!.functionType === 'action')
        return null;
    const newSchema = stmt.expression.schema;
    if (!(newSchema instanceof Ast.FunctionDef))
        return null;

    if (C.isSameFunction(currentTable.schema!, newSchema))
        return null;

    const currentSchema = currentTable.schema;
    assert(currentSchema instanceof Ast.FunctionDef);

    const functionName = newSchema.qualifiedName;
    const related = currentSchema.getAnnotation<string[]>('related');
    if (!related || !related.includes(functionName))
        return null;

    if (!C.checkValidQuery(stmt.expression))
        return null;

    const newTable = stmt.expression.clone();
    const newFilterTable = findOrMakeFilterExpression(newTable);
    if (newFilterTable === null)
        return null;
    if (!(newFilterTable.expression instanceof Ast.InvocationExpression))
        return null;

    const ctxFilterTable = C.findFilterExpression(currentTable);

    if (ctxFilterTable) {
        const newFilter = refineFilterToAnswerQuestion(ctxFilterTable.filter, newFilterTable.filter);
        if (newFilter === null)
            return null;
        newFilterTable.filter = newFilter;
    }

    return addQuery(ctx, 'execute', newTable, 'accepted');
}

export {
    relatedQuestion,
};
