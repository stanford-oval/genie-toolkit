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
    addQuery,
} from '../state_manip';
import {
    queryRefinement,
    refineFilterToChangeFilter
} from './refinement-helpers';
import {
    isValidSearchQuestion
} from './common';

// Refinement dialogue acts: the search is NOT complete (0, or more than 1 result), and the
// agent doesn't want to show results
//
// These include proposals, and empty search errors.
// A proposal is when the agent proposed a refined search; the user answers:
// - some form of "yes"
// - some form of "no" followed by another search refinement

type EmptySearch = [Ast.Expression|null, C.ParamSlot|null];

/**
 * Agent dialogue act: a search command returned no result.
 *
 * @param ctx - the current context
 * @param base - the base table used in the reply
 * @param question - a search question used in the reply
 */
function makeEmptySearchError(ctx : ContextInfo, [base, question] : EmptySearch) {
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

function emptySearchChangePhraseCommon(ctx : ContextInfo, newFilter : Ast.BooleanExpression) {
    const currentStmt = ctx.current!.stmt;
    const currentTable = currentStmt.expression;
    const newTable = queryRefinement(currentTable, newFilter, refineFilterToChangeFilter, null);
    if (newTable === null)
        return null;
    return addQuery(ctx, 'execute', newTable, 'accepted');
}

/**
 * User dialogue act: in response to an empty search, the user changes their constraints.
 *
 * The "precise" variant explicitly contains a reference to a table, which must be the same
 * as the context.
 */
function preciseEmptySearchChangeRequest(ctx : ContextInfo, phrase : Ast.Expression) {
    if (!(phrase instanceof Ast.FilterExpression))
        return null;
    const [, param] = ctx.aux as EmptySearch;
    if (!C.isSameFunction(ctx.currentTableFunction!, phrase.schema!))
        return null;
    if (param !== null && !C.filterUsesParam(phrase.filter, param.name))
        return null;

    return emptySearchChangePhraseCommon(ctx, phrase.filter);
}

/**
 * User dialogue act: in response to an empty search, the user changes their constraints.
 *
 * The "imprecise" variant only contains a value and optionally a parameter name.
 * The table is inferred from the context.
 */
function impreciseEmptySearchChangeRequest(ctx : ContextInfo, answer : Ast.Value|C.FilterSlot) {
    const [base, param] = ctx.aux as EmptySearch;
    // because we're imprecise, we're only valid if the agent asked a specific question
    if (base === null || param === null)
        return null;
    let answerFilter : C.FilterSlot|null;
    if (answer instanceof Ast.Value)
        answerFilter = C.makeFilter(param, '==', answer);
    else
        answerFilter = answer;
    if (answerFilter === null || !(answerFilter instanceof Ast.AtomBooleanExpression))
        return null;
    if (answerFilter.name !== param.name)
        return null;
    if (!C.checkFilter(base, answerFilter))
        return null;

    return emptySearchChangePhraseCommon(ctx, answerFilter);
}

export {
    makeEmptySearchError,
    preciseEmptySearchChangeRequest,
    impreciseEmptySearchChangeRequest
};
