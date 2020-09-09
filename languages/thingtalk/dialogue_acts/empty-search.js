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
"use strict";

const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const C = require('../ast_manip');

const {
    makeAgentReply,
    makeSimpleState,
    addQuery,
} = require('../state_manip');
const {
    queryRefinement,
    refineFilterToChangeFilter
} = require('./refinement-helpers');
const {
    isValidSearchQuestion
} = require('./common');

// Refinement dialogue acts: the search is NOT complete (0, or more than 1 result), and the
// agent doesn't want to show results
//
// These include proposals, and empty search errors.
// A proposal is when the agent proposed a refined search; the user answers:
// - some form of "yes"
// - some form of "no" followed by another search refinement

/**
 * Agent dialogue act: a search command returned no result.
 *
 * @param ctx - the current context
 * @param base - the base table used in the reply
 * @param question - a search question used in the reply
 */
function makeEmptySearchError(ctx, [base, question]) {
    if (base !== null && !C.isSameFunction(base.schema, ctx.currentFunctionSchema))
        return null;


    let type, state;
    if (question !== null) {
        if (!isGoodEmptySearchQuestion(ctx, question.name))
            return null;

        const arg = ctx.currentFunctionSchema.getArgument(question.name);
        type = arg.type;
        state = makeSimpleState(ctx, 'sys_empty_search_question', question.name);
    } else {
        type = null;
        state = makeSimpleState(ctx, 'sys_empty_search', null);
    }
    return makeAgentReply(ctx, state, [base, question], type);
}

function isGoodEmptySearchQuestion(ctx, question) {
    assert(typeof question === 'string');
    if (!isValidSearchQuestion(ctx.current.stmt.table, [question]))
        return false;

    const ctxFilterTable = C.findFilterTable(ctx.current.stmt.table);
    if (!ctxFilterTable || !C.filterUsesParam(ctxFilterTable.filter, question))
        return false;

    return true;
}

function emptySearchChangePhraseCommon(ctx, newFilter) {
    const currentTable = ctx.current.stmt.table;
    const newTable = queryRefinement(currentTable, newFilter, refineFilterToChangeFilter);
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
function preciseEmptySearchChangeRequest(ctx, phrase) {
    const [, param] = ctx.aux;
    if (!C.isSameFunction(ctx.currentFunctionSchema, phrase.schema))
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
function impreciseEmptySearchChangeRequest(ctx, answer) {
    const [base, param] = ctx.aux;
    // because we're imprecise, we're only valid if the agent asked a specific question
    if (base === null || param === null)
        return null;
    if (answer instanceof Ast.Value)
        answer = C.makeFilter(param, '==', answer);
    if (answer === null)
        return null;
    if (answer.name !== param.name)
        return null;
    if (!C.checkFilter(base, answer))
        return null;

    return emptySearchChangePhraseCommon(ctx, answer);
}

module.exports = {
    makeEmptySearchError,
    preciseEmptySearchChangeRequest,
    impreciseEmptySearchChangeRequest
};
