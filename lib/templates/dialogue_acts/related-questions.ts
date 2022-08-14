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
import { appendFileSync } from 'fs';
import { Ast, } from 'thingtalk';
import { applyMultipleLevenshtein, determineSameExpressionLevenshtein, Levenshtein } from 'thingtalk/dist/ast';

import * as C from '../ast_manip';

import {
    ContextInfo,
    addQuery,
} from '../state_manip';
import {
    findOrMakeFilterExpression,
    refineFilterToAnswerQuestion,
} from './refinement-helpers';

function relatedQuestion(ctx : ContextInfo, expr : Ast.Expression) {
    const currentStmt = ctx.current!.stmt;
    const currentTable = currentStmt.expression;

    if (expr.schema!.functionType !== 'query')
        return null;
    const newSchema = expr.schema!;
    // GEORGE: investigate how the invocation in expr is set. Probably in another semantic function
    if (C.isSameFunction(currentTable.schema!, newSchema))
        return null;

    const currentSchema = currentTable.schema;
    assert(currentSchema instanceof Ast.FunctionDef);

    const functionName = newSchema.qualifiedName;
    const related = currentSchema.getAnnotation<string[]>('related');
    if (!related || !related.includes(functionName))
        return null;

    if (!C.checkValidQuery(expr))
        return null;

    const newTable = C.toChainExpression(expr.clone());
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

    // Levenshtein testing
    const delta1 = new Levenshtein(null, expr, "$continue");
    const applyres = applyMultipleLevenshtein(currentStmt.expression, [delta1]);
    if (!determineSameExpressionLevenshtein(applyres, newTable)) {
        const print2 = `last-turn expression   : ${currentStmt.expression.prettyprint()}\n`;
        const print3 = `levenshtein expressions: ${[delta1].map((i) => i.prettyprint())}\n`;
        const print4 = `applied result         : ${applyres.prettyprint()}\n`;
        const print5 = `expected expression    : ${newTable.prettyprint()}\n`;
        appendFileSync("/Users/shichengliu/Desktop/Monica_research/workdir/levenshtein_debug/relatedQuestion_multiwoz.txt", print2 + print3 + print4 + print5);
    }

    return addQuery(ctx, 'execute', newTable, 'accepted');
}

export {
    relatedQuestion,
};
