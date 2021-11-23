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

import { StateM } from '../../utils/thingtalk';
import type ThingpediaLoader from '../../templates/load-thingpedia';
import * as C from '../../templates/ast_manip';

import { POLICY_NAME } from '../metadata';
import { ContextInfo } from '../context-info';
import {
    addQuery,
    addQueryAndAction,
} from '../state_manip';
import {
    queryRefinement,
    refineFilterToAnswerQuestion
} from './refinement-helpers';
import {
    makeAgentReply,
    isValidSearchQuestion,
    isSimpleFilterExpression,
    addParametersFromContext
} from './common';

export type PreciseSearchQuestionAnswer = [Ast.Expression, Ast.Invocation|null, boolean];

export function preciseSearchQuestionAnswerKeyFn([table, action, hasYes] : PreciseSearchQuestionAnswer) {
    return {
        functionName: table.schema!.qualifiedName,
        actionFunctionName: action ? action.schema!.qualifiedName : null
    };
}

function isGoodSearchQuestion(ctx : ContextInfo, questions : C.ParamSlot[]) {
    const currentStmt = ctx.current!.stmt;
    if (!isValidSearchQuestion(currentStmt.lastQuery!, questions))
        return false;

    const ctxFilterTable = C.findFilterExpression(currentStmt.expression);
    if (!ctxFilterTable)
        return false;
    for (const q of questions) {
        if (C.filterUsesParam(ctxFilterTable.filter, q.name))
            return false;
    }
    return true;
}

function checkFilterPairForDisjunctiveQuestion(ctx : ContextInfo,
                                               f1 : C.FilterSlot,
                                               f2 : C.FilterSlot) : C.ParamSlot|null {
    if (!(f1.ast instanceof Ast.AtomBooleanExpression))
        return null;
    if (!(f2.ast instanceof Ast.AtomBooleanExpression))
        return null;
    if (!ctx.currentFunction!.is_list)
        return null;
    if (!C.isSameFunction(ctx.currentFunction!, f1.schema))
        return null;
    if (!C.isSameFunction(f1.schema, f2.schema))
        return null;
    if (f1.ast.name !== f2.ast.name)
        return null;
    if (!f1.ast.value.getType().equals(f2.ast.value.getType()))
        return null;
    if (f1.ast.value.equals(f2.ast.value))
        return null;
    const filterable = f1.schema.getArgument(f1.ast.name)!
        .getImplementationAnnotation<boolean>('filterable') ?? true;
    if (!filterable)
        return null;

    let good1 = false;
    let good2 = false;
    for (const result of ctx.results!) {
        const value = result.value[f1.ast.name];
        if (!value)
            return null;
        if (value.equals(f1.ast.value))
            good1 = true;
        if (value.equals(f2.ast.value))
            good2 = true;
        if (good1 && good2)
            break;
    }
    if (!good1 || !good2)
        return null;

    const symmetric = f1.schema.getArgument(f1.ast.name)!.getImplementationAnnotation<boolean>('symmetric') ?? false;
    return { schema: f1.schema, type: f1.ptype, name: f1.ast.name,
        filterable, symmetric, ast: new Ast.Value.VarRef(f1.ast.name) };
}

export function checkFilterPairForDisjunctiveQuestionWithConstant(ctx : ContextInfo,
                                                                  loader : ThingpediaLoader,
                                                                  f1 : C.FilterSlot,
                                                                  c : Ast.Value) : C.ParamSlot|null {
    if (!(f1.ast instanceof Ast.AtomBooleanExpression))
        return null;
    const filterable = f1.schema.getArgument(f1.ast.name)!
        .getImplementationAnnotation<boolean>('filterable') ?? true;
    const symmetric = f1.schema.getArgument(f1.ast.name)!
        .getImplementationAnnotation<boolean>('symmetric') ?? false;
    const pslot = { schema: f1.schema, name: f1.ast.name, type: f1.ptype, filterable, symmetric,
        ast: new Ast.Value.VarRef(f1.ast.name) };
    const f2 = C.makeFilter(loader, pslot, f1.ast.operator, c);
    if (!f2)
        return null;
    return checkFilterPairForDisjunctiveQuestion(ctx, f1, f2);
}

function makeSearchQuestion(ctx : ContextInfo, questions : C.ParamSlot[]) {
    if (!isGoodSearchQuestion(ctx, questions))
        return null;

    if (questions.length === 0)
        return makeAgentReply(ctx, StateM.makeSimpleState(ctx.state, POLICY_NAME, 'sys_generic_search_question'));

    if (questions.length === 1) {
        const currentStmt = ctx.current!.stmt;
        const type = currentStmt.lastQuery!.schema!.getArgument(questions[0].name)!.type;
        return makeAgentReply(ctx, StateM.makeSimpleState(ctx.state, POLICY_NAME, 'sys_search_question', questions.map((q) => q.name)), null, type);
    }

    return makeAgentReply(ctx, StateM.makeSimpleState(ctx.state, POLICY_NAME, 'sys_search_question', questions.map((q) => q.name)));
}

class AnswersQuestionVisitor extends Ast.NodeVisitor {
    answersQuestion = false;
    constructor(private questions : string[]) {
        super();
    }

    visitAtomBooleanExpression(atom : Ast.AtomBooleanExpression) {
        if (this.questions.some((q) => q === atom.name))
            this.answersQuestion = true;
        return true;
    }
    visitDontCareBooleanExpression(atom : Ast.DontCareBooleanExpression) {
        if (this.questions.some((q) => q === atom.name))
            this.answersQuestion = true;
        return true;
    }
}

/**
 * Check if the table filters on the parameters `questions` (effectively providing a constraint on question)
 */
function isQueryAnswerValidForQuestion(table : Ast.Expression, questions : string[]) {
    assert(Array.isArray(questions));
    const visitor = new AnswersQuestionVisitor(questions);
    table.visit(visitor);
    return visitor.answersQuestion;
}

function preciseSearchQuestionAnswer(ctx : ContextInfo, [answerTable, answerAction, _bool] : [Ast.Expression, Ast.Invocation|null, boolean]) {
    const questions = ctx.state.dialogueActParam as string[];
    assert(questions === null || (Array.isArray(questions) && questions.length > 0 && questions.every((q) => typeof q === 'string')));
    if (questions !== null && !isQueryAnswerValidForQuestion(answerTable, questions))
        return null;
    if (!(answerTable instanceof Ast.FilterExpression))
        return null;

    if (!C.isSameFunction(answerTable.schema!, ctx.currentFunction!))
        return null;
    const currentStmt = ctx.current!.stmt;
    const currentTable = currentStmt.expression;

    // TODO we need to push down the filter, if possible
    if (!isSimpleFilterExpression(answerTable))
        return null;

    if (answerAction !== null) {
        assert(answerAction instanceof Ast.Invocation);
        if (ctx.nextFunction !== null) {
            if (!C.isSameFunction(answerAction.schema!, ctx.nextFunction!))
                return null;

            // check that we don't fill the chain parameter through this path:
            // the chain parameter can only be filled if the agent shows the results
            for (const in_param of answerAction.in_params) {
                if (in_param.name === ctx.nextInfo!.chainParameter &&
                    !ctx.nextInfo!.chainParameterFilled)
                    return null;
            }

            const contextInvocation = C.getInvocation(ctx.next!);
            assert(contextInvocation instanceof Ast.Invocation);
            answerAction = addParametersFromContext(answerAction, contextInvocation);
        }
    }

    const newTable = queryRefinement(currentTable, answerTable.filter, refineFilterToAnswerQuestion, null);
    if (newTable === null)
        return null;
    if (answerAction !== null)
        return addQueryAndAction(ctx, 'execute', newTable, answerAction, 'accepted');
    else
        return addQuery(ctx, 'execute', newTable, 'accepted');
}


function impreciseSearchQuestionAnswer(ctx : ContextInfo, loader : ThingpediaLoader, answer : C.FilterSlot|Ast.Value|'dontcare') {
    const questions = ctx.state.dialogueActParam as string[];
    if (questions === null || questions.length !== 1)
        return null;
    assert(Array.isArray(questions) && questions.length > 0 && questions.every((q) => typeof q === 'string'));

    let answerFilter : C.FilterSlot;
    if (answer === 'dontcare') {
        answerFilter = {
            schema: ctx.currentFunction!,
            ptype: ctx.currentFunction!.getArgType(questions[0])!,
            ast: new Ast.BooleanExpression.DontCare(null, questions[0])
        };
    } else if (answer instanceof Ast.Value) {
        assert(questions.length === 1);
        assert(answer instanceof Ast.Value);

        const arg = ctx.currentFunction!.getArgument(questions[0])!;
        const pslot = { schema: ctx.currentFunction!,
            type: arg.type,
            filterable: arg.getImplementationAnnotation<boolean>('filterable') ?? true,
            symmetric: arg.getImplementationAnnotation<boolean>('symmetric') ?? false,
            name: questions[0],
            ast: new Ast.Value.VarRef(questions[0]) };
        const newFilter = C.makeFilter(loader, pslot, '==', answer);
        if (newFilter === null)
            return null;
        answerFilter = newFilter;
    } else {
        answerFilter = answer;
        let pname : string;
        if (answer.ast instanceof Ast.AndBooleanExpression) {
            assert(answer.ast.operands.length === 2);
            const [op1, op2] = answer.ast.operands;
            assert(op1 instanceof Ast.AtomBooleanExpression
                   && op2 instanceof Ast.AtomBooleanExpression);
            assert(op1.name === op2.name &&
                   op1.value.getType().equals(op2.value.getType()));
            pname = op1.name;
        } else if (answer.ast instanceof Ast.NotBooleanExpression) {
            const inner = answer.ast.expr;
            assert(inner instanceof Ast.AtomBooleanExpression ||
                   inner instanceof Ast.DontCareBooleanExpression);
            pname = inner.name;
        } else {
            assert(answer.ast instanceof Ast.AtomBooleanExpression ||
                   answer.ast instanceof Ast.DontCareBooleanExpression);
            pname = answer.ast.name;
        }
        if (!questions.some((q) => q === pname))
            return null;
    }

    const currentStmt = ctx.current!.stmt;
    const currentTable = currentStmt.expression;
    if (!C.checkFilter(loader, currentTable, answerFilter))
        return null;

    const newTable = queryRefinement(currentTable, answerFilter.ast, refineFilterToAnswerQuestion, null);
    if (newTable === null)
        return null;
    return addQuery(ctx, 'execute', newTable, 'accepted');
}

export {
    checkFilterPairForDisjunctiveQuestion,
    makeSearchQuestion,
    preciseSearchQuestionAnswer,
    impreciseSearchQuestionAnswer
};
