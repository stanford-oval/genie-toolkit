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
    addNewStatement,
    addQuery,
    acceptAllProposedStatements
} from '../state_manip';
import {
    queryRefinement,
    refineFilterForEmptySearch,
    RefineFilterCallback
} from './refinement-helpers';
import {
    isValidSearchQuestion
} from './common';

type EmptySearch = [Ast.Expression|null, C.ParamSlot|null, boolean];

/**
 * Agent dialogue act: a search command returned no result.
 *
 * @param ctx - the current context
 * @param base - the base table used in the reply
 * @param question - a search question used in the reply
 */
export function makeEmptySearchError(ctx : ContextInfo, [base, question, offerMonitor] : EmptySearch) {
    if (base !== null && !C.isSameFunction(base.schema!, ctx.currentTableFunction!))
        return null;
    if (question !== null && !C.isSameFunction(ctx.currentTableFunction!, question.schema))
        return null;

    let type, state;
    if (question !== null) {
        if (!isGoodEmptySearchQuestion(ctx, question))
            return null;

        const arg = ctx.currentTableFunction!.getArgument(question.name);
        if (!arg)
            return null;
        type = arg.type;
        state = makeSimpleState(ctx, 'sys_empty_search_question', [question.name]);
    } else if (offerMonitor) {
        const monitor = C.tableToStream(ctx.current!.stmt.lastQuery!, { monitorItemID : true });
        if (!monitor)
            return null;
        state = addNewStatement(ctx, 'sys_empty_search', null, 'proposed', monitor);
    } else {
        type = null;
        state = makeSimpleState(ctx, 'sys_empty_search', null);
    }
    return makeAgentReply(ctx, state, [base, question], type);
}

function isGoodEmptySearchQuestion(ctx : ContextInfo, question : C.ParamSlot) {
    const currentStmt = ctx.current!.stmt;
    const currentTable = currentStmt.expression;
    if (!isValidSearchQuestion(currentTable, [question]))
        return false;

    const ctxFilterTable = C.findFilterExpression(currentTable);
    if (!ctxFilterTable || !C.filterUsesParam(ctxFilterTable.filter, question.name))
        return false;

    return true;
}

function emptySearchChangePhraseCommon(ctx : ContextInfo,
                                       newFilter : Ast.BooleanExpression,
                                       refineFilter : RefineFilterCallback) {
    const currentStmt = ctx.current!.stmt;
    const currentExpression = currentStmt.expression;
    const newExpression = queryRefinement(currentExpression, newFilter, refineFilter, null);
    if (newExpression === null)
        return null;
    // XXX: do we want to remove any sort/index?
    
    // Levenshtein: adding a filter
    const deltaFilterStatement = new Ast.FilterExpression(null, Ast.levenshteinFindSchema(currentStmt.expression), newFilter, currentStmt.expression.schema);
    const delta = (new Ast.Levenshtein(null, deltaFilterStatement, "$continue")).optimize();
    const applyres = Ast.applyLevenshteinSync(currentStmt.expression, delta);
    C.levenshteinDebugOutput(applyres, newExpression, "emptySearchChangePhraseCommon.txt", [delta], currentStmt.expression);
    
    return addQuery(ctx, 'execute', applyres, 'accepted', delta);
}

/**
 * User dialogue act: in response to an empty search, the user changes their constraints.
 *
 * The "precise" variant explicitly contains a reference to a table, which must be the same
 * as the context.
 */
export function preciseEmptySearchChangeRequest(ctx : ContextInfo,
                                                phrase : Ast.Expression) {
    if (!(phrase instanceof Ast.FilterExpression))
        return null;
    const [, param] = ctx.aux as EmptySearch;
    if (!C.isSameFunction(ctx.currentTableFunction!, phrase.schema!))
        return null;
    if (param !== null && !C.filterUsesParam(phrase.filter, param.name))
        return null;

    return emptySearchChangePhraseCommon(ctx, phrase.filter, refineFilterForEmptySearch);
}

/**
 * User dialogue act: in response to an empty search, the user changes their constraints.
 *
 * The "imprecise" variant only contains a value and optionally a parameter name.
 * The table is inferred from the context.
 */
export function impreciseEmptySearchChangeRequest(ctx : ContextInfo,
                                                  answer : Ast.Value|C.FilterSlot) {
    const [base, param] = ctx.aux as EmptySearch;
    // because we're imprecise, we're only valid if the agent asked a specific question
    if (base === null || param === null)
        return null;
    let answerFilter : C.FilterSlot|null;
    if (answer instanceof Ast.Value)
        answerFilter = C.makeFilter(ctx.loader, param, '==', answer);
    else
        answerFilter = answer;
    if (answerFilter === null || !(answerFilter instanceof Ast.AtomBooleanExpression))
        return null;
    if (answerFilter.name !== param.name)
        return null;
    if (!C.checkFilter(ctx.loader, base, answerFilter))
        return null;

    return emptySearchChangePhraseCommon(ctx, answerFilter, refineFilterForEmptySearch);
}

/**
 * User dialogue act: in response to an empty search where the agent proposed a statement,
 * the user accepts the statement.
 */
export function acceptEmptySearchOffer(ctx : ContextInfo) {
    return acceptAllProposedStatements(ctx);
}
