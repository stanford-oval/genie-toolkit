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
    getActionInvocation,
    makeAgentReply,
    makeSimpleState,
    addQuery,
    addQueryAndAction,
} = require('../state_manip');
const {
    queryRefinement,
    refineFilterToAnswerQuestion
} = require('./refinement-helpers');
const {
    isValidSearchQuestion,
    addParametersFromContext
} = require('./common');

function isGoodSearchQuestion(ctx, questions) {
    if (!isValidSearchQuestion(ctx.current.stmt.table, questions))
        return false;

    const ctxFilterTable = C.findFilterTable(ctx.current.stmt.table);
    if (!ctxFilterTable)
        return false;
    for (let q of questions) {
        if (C.filterUsesParam(ctxFilterTable.filter, q))
            return false;
    }
    return true;
}

function checkFilterPairForDisjunctiveQuestion(ctx, f1, f2) {
    if (f1.name !== f2.name)
        return null;
    if (!f1.value.getType().equals(f2.value.getType()))
        return null;
    if (f1.value.equals(f2.value))
        return null;

    let good1 = false;
    let good2 = false;
    for (let result of ctx.results) {
        const value = result.value[f1.name];
        if (!value)
            return null;
        if (value.equals(f1.value))
            good1 = true;
        if (value.equals(f2.value))
            good2 = true;
        if (good1 && good2)
            break;
    }
    if (!good1 || !good2)
        return null;

    return [f1.name, f1.value.getType()];
}

function makeSearchQuestion(ctx, questions) {
    if (!isGoodSearchQuestion(ctx, questions))
        return null;

    if (questions.length === 0)
        return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_generic_search_question', null));

    if (questions.length === 1) {
        const type = ctx.currentFunctionSchema.getArgument(questions[0]).type;
        return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_search_question', questions), null, type);
    }

    return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_search_question', questions));
}

/**
 * Check if the table filters on the parameters `questions` (effectively providing a constraint on question)
 */
function isQueryAnswerValidForQuestion(table, questions) {
    assert(Array.isArray(questions));
    let answersQuestion = false;
    table.visit(new class extends Ast.NodeVisitor {
        visitAtomBooleanExpression(atom) {
            if (questions.some((q) => q === atom.name))
                answersQuestion = true;
            return true;
        }
        visitDontCareBooleanExpression(atom) {
            if (questions.some((q) => q === atom.name))
                answersQuestion = true;
            return true;
        }
    });
    return answersQuestion;
}

function preciseSearchQuestionAnswer(ctx, [answerTable, answerAction]) {
    const questions = ctx.state.dialogueActParam;
    if (questions !== null && !isQueryAnswerValidForQuestion(answerTable, questions))
        return null;

    const answerFunctions = C.getFunctionNames(answerTable);
    assert(answerFunctions.length === 1);
    if (answerFunctions[0] !== ctx.currentFunction)
        return null;
    const currentTable = ctx.current.stmt.table;
    if (!isValidSearchQuestion(currentTable, questions || []))
        return null;
    assert(answerTable.isFilter && ((answerTable.table.isCompute && answerTable.table.table.isInvocation) || answerTable.table.isInvocation));

    if (answerAction !== null) {
        const answerFunctions = C.getFunctionNames(answerAction);
        assert(answerFunctions.length === 1);
        assert(answerAction instanceof Ast.Invocation);
        if (ctx.nextFunction !== null) {
            if (answerFunctions[0] !== ctx.nextFunction)
                return null;

            // check that we don't fill the chain parameter through this path:
            // the chain parameter can only be filled if the agent shows the results
            for (let in_param of answerAction.in_params) {
                if (in_param.name === ctx.nextInfo.chainParameter &&
                    !ctx.nextInfo.chainParameterFilled)
                    return null;
            }

            answerAction = addParametersFromContext(answerAction, getActionInvocation(ctx.next));
        }
    }

    const newTable = queryRefinement(currentTable, answerTable.filter, refineFilterToAnswerQuestion);
    if (newTable === null)
        return null;
    if (answerAction !== null)
        return addQueryAndAction(ctx, 'execute', newTable, answerAction, 'accepted');
    else
        return addQuery(ctx, 'execute', newTable, 'accepted');
}


function impreciseSearchQuestionAnswer(ctx, answer) {
    const questions = ctx.state.dialogueActParam;
    if (questions === null || questions.length !== 1)
        return null;
    assert(Array.isArray(questions) && questions.length > 0);
    if (answer === 'dontcare') {
        answer = new Ast.BooleanExpression.DontCare(null, questions[0]);
    } else if (answer instanceof Ast.BooleanExpression) {
        let pname;
        if (answer.isNot) {
            assert(answer.expr.isAtom || answer.expr.isDontCare);
            pname = answer.expr.name;
        } else {
            assert(answer.isAtom || answer.isDontCare);
            pname = answer.name;
        }
        if (!questions.some((q) => q === pname))
            return null;
    } else {
        assert(questions.length === 1);
        assert(answer instanceof Ast.Value);
        answer = C.makeFilter(new Ast.Value.VarRef(questions[0]), '==', answer);
        if (answer === null)
            return null;
    }

    assert(answer instanceof Ast.BooleanExpression);
    const currentTable = ctx.current.stmt.table;
    if (!C.checkFilter(currentTable, answer))
        return null;

    const newTable = queryRefinement(currentTable, answer, refineFilterToAnswerQuestion);
    if (newTable === null)
        return null;
    return addQuery(ctx, 'execute', newTable, 'accepted');
}

module.exports = {
    checkFilterPairForDisjunctiveQuestion,
    makeSearchQuestion,
    preciseSearchQuestionAnswer,
    impreciseSearchQuestionAnswer
};
