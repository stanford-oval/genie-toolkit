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
    queryRefinement,
    refineFilterToAnswerQuestion,
} from './refinement-helpers';
import type { Recommendation } from './recommendation';
import type { ListProposal } from './list-proposal';
import { applyMultipleLevenshtein, Levenshtein, levenshteinFindSchema, ProjectionExpression, FilterExpression } from 'thingtalk/dist/ast';

export type UserSearchQuestionForList = [Ast.EntityValue|Ast.NumberValue|null, C.ParamSlot[]];

export function userSearchQuestionForListKeyFn([name, questions] : UserSearchQuestionForList) {
    if (questions.length === 0)
        return { idType: null, functionName: null };

    return {
        idType: name ? name.getType() : null,
        functionName: questions[0].schema.qualifiedName
    };
}

function areQuestionsValidForContext(ctx : ContextInfo, questions : C.ParamSlot[]) {
    if (ctx.resultInfo!.isAggregation)
        return null;

    const schema = ctx.currentFunction!;

    // if the function only contains one parameter, do not generate projection for it
    if (C.countInputOutputParams(schema).output === 1)
        return null;

    for (const q of questions) {
        if (!C.isSameFunction(schema, q.schema))
            return false;
        const arg = schema.getArgument(q.name);
        if (!arg || arg.is_input)
            return false;
    }
    return true;
}

function removeMonitorInner(expr : Ast.Expression) : Ast.Expression {
    if (expr instanceof Ast.MonitorExpression)
        return expr.expression;

    if (expr instanceof Ast.FilterExpression ||
        expr instanceof Ast.ProjectionExpression)
        return removeMonitorInner(expr.expression);

    return expr;
}

function removeMonitor(expr : Ast.ChainExpression) : Ast.ChainExpression {
    if (expr instanceof Ast.ChainExpression &&
        expr.first.schema!.functionType === 'stream') {
        const withoutMonitor = removeMonitorInner(expr.first);
        const clone = expr.expressions.slice();
        clone[0] = withoutMonitor;
        return new Ast.ChainExpression(null, clone, expr.schema);
    }

    return expr;
}

function recommendationSearchQuestionReply(ctx : ContextInfo, questions : C.ParamSlot[]) {
    const proposal = ctx.aux as Recommendation;
    const { topResult, info, } = proposal;
    if (!topResult.value.id)
        return null;
    if (info !== null) {
        for (const q of questions) {
            if (info.has(q.name))
                return null;
        }
    }

    if (!areQuestionsValidForContext(ctx, questions))
        return null;

    const currentStmt = ctx.current!.stmt;
    const currentTable = removeMonitor(currentStmt.expression);
    const newFilter = new Ast.BooleanExpression.Atom(null, 'id', '==', topResult.value.id);
    const newTable = queryRefinement(currentTable, newFilter, refineFilterToAnswerQuestion,
        questions.map((q) => q.name));
    if (newTable === null)
        return null;
    const res = addQuery(ctx, 'execute', newTable, 'accepted');

    // Levenshtein testing
    const deltaFilterStatement = new FilterExpression(null, levenshteinFindSchema(currentStmt.expression), newFilter, null);
    const delta1 = new Levenshtein(null, deltaFilterStatement, "$continue");
    const deltaProjectionStatement = new ProjectionExpression(null, levenshteinFindSchema(currentStmt.expression), questions.map((q) => q.name), [], [], null);
    const delta2 = new Levenshtein(null, deltaProjectionStatement, "$continue");
    const applyres = applyMultipleLevenshtein(currentStmt.expression, [delta1, delta2]);
    // if (!determineSameExpressionLevenshtein(applyres, newTable)) {
    //     const print2 = `last-turn expression   : ${currentStmt.expression.prettyprint()}\n`;
    //     const print3 = `levenshtein expressions: ${[delta1, delta2].map((i) => i.prettyprint())}\n`;
    //     const print4 = `applied result         : ${applyres.prettyprint()}\n`;
    //     const print5 = `expected expression    : ${newTable.prettyprint()}\n`;
    //     appendFileSync("/Users/shichengliu/Desktop/Monica_research/workdir/levenshtein_debug/recommendationSearchQuestionReply_multiwoz.txt", print2 + print3 + print4 + print5);
    // }
    C.levenshteinDebugOutput(applyres, newTable, "recommendationSearchQuestionReply_multiwoz.txt");
    return res;
}

function learnMoreSearchQuestionReply(ctx : ContextInfo, questions : C.ParamSlot[]) {
    const topResult = ctx.results![0];
    if (!areQuestionsValidForContext(ctx, questions))
        return null;

    const currentStmt = ctx.current!.stmt;
    const currentTable = removeMonitor(currentStmt.expression);
    if (!topResult.value.id)
        return null;
    const newFilter = new Ast.BooleanExpression.Atom(null, 'id', '==', topResult.value.id);
    const newTable = queryRefinement(currentTable, newFilter, refineFilterToAnswerQuestion,
        questions.map((q) => q.name));
    if (newTable === null)
        return null;
    // Levenshtein testing
    const deltaFilterStatement = new FilterExpression(null, levenshteinFindSchema(currentStmt.expression), newFilter, null);
    const delta1 = new Levenshtein(null, deltaFilterStatement, "$continue");
    const deltaProjectionStatement = new ProjectionExpression(null, levenshteinFindSchema(currentStmt.expression), questions.map((q) => q.name), [], [], null);
    const delta2 = new Levenshtein(null, deltaProjectionStatement, "$continue");
    const applyres = applyMultipleLevenshtein(currentStmt.expression, [delta1, delta2]);
    // if (!determineSameExpressionLevenshtein(applyres, newTable)) {
    //     const print2 = `last-turn expression   : ${currentStmt.expression.prettyprint()}\n`;
    //     const print3 = `levenshtein expressions: ${[delta1, delta2].map((i) => i.prettyprint())}\n`;
    //     const print4 = `applied result         : ${applyres.prettyprint()}\n`;
    //     const print5 = `expected expression    : ${newTable.prettyprint()}\n`;
    //     appendFileSync("/Users/shichengliu/Desktop/Monica_research/workdir/levenshtein_debug/learnMoreSearchQuestionReply_multiwoz.txt", print2 + print3 + print4 + print5);
    // }
    C.levenshteinDebugOutput(applyres, newTable, "learnMoreSearchQuestionReply_multiwoz.txt");
    
    return addQuery(ctx, 'execute', newTable, 'accepted');
}

function displayResultSearchQuestionReply(ctx : ContextInfo, questions : C.ParamSlot[]) {
    if (!areQuestionsValidForContext(ctx, questions))
        return null;

    const currentStmt = ctx.current!.stmt;
    const currentTable = removeMonitor(currentStmt.expression);
    const newTable = queryRefinement(currentTable, null, refineFilterToAnswerQuestion,
        questions.map((q) => q.name));
    if (newTable === null)
        return null;

    const deltaProjectionStatement = new ProjectionExpression(null, levenshteinFindSchema(currentStmt.expression), questions.map((q) => q.name), [], [], null);
    const delta2 = new Levenshtein(null, deltaProjectionStatement, "$continue");
    const applyres = applyMultipleLevenshtein(currentStmt.expression, [delta2]);
    // if (!determineSameExpressionLevenshtein(applyres, newTable)) {
    //     const print2 = `last-turn expression   : ${currentStmt.expression.prettyprint()}\n`;
    //     const print3 = `levenshtein expressions: ${[delta2].map((i) => i.prettyprint())}\n`;
    //     const print4 = `applied result         : ${applyres.prettyprint()}\n`;
    //     const print5 = `expected expression    : ${newTable.prettyprint()}\n`;
    //     appendFileSync("/Users/shichengliu/Desktop/Monica_research/workdir/levenshtein_debug/displayResultSearchQuestionReply_multiwoz.txt", print2 + print3 + print4 + print5);
    // }
    C.levenshteinDebugOutput(applyres, newTable, "displayResultSearchQuestionReply_multiwoz.txt");
    return addQuery(ctx, 'execute', newTable, 'accepted');
}

function listProposalSearchQuestionReply(ctx : ContextInfo, [name, questions] : [Ast.Value|null, C.ParamSlot[]]) {
    const proposal = ctx.aux as ListProposal;
    const { results, info } = proposal;

    if (name !== null) {
        let good = false;
        for (const result of results) {
            if (!result.value.id)
                continue;
            if (result.value.id.equals(name)) {
                good = true;
                break;
            }
        }
        if (!good)
            return null;
    }

    if (info !== null) {
        for (const q of questions) {
            if (info.has(q.name))
                return null;
        }
    }

    if (!areQuestionsValidForContext(ctx, questions))
        return null;

    const currentStmt = ctx.current!.stmt;
    const currentTable = currentStmt.expression;
    let newTable;
    const listLevenshtein : Levenshtein[] = [];
    if (name !== null) {
        const newFilter = new Ast.BooleanExpression.Atom(null, 'id', '==', name);
        newTable = queryRefinement(currentTable, newFilter, refineFilterToAnswerQuestion,
            questions.map((q) => q.name));
        const deltaFilterStatement = new FilterExpression(null, levenshteinFindSchema(currentStmt.expression), newFilter, null);
        const delta1 = new Levenshtein(null, deltaFilterStatement, "$continue");
        listLevenshtein.push(delta1);

    } else {
        newTable = queryRefinement(currentTable, null, null,
            questions.map((q) => q.name));
    }
    if (newTable === null)
        return null;
    
    const deltaProjectionStatement = new ProjectionExpression(null, levenshteinFindSchema(currentStmt.expression), questions.map((q) => q.name), [], [], null);
    const delta2 = new Levenshtein(null, deltaProjectionStatement, "$continue");
    listLevenshtein.push(delta2);


    const applyres = applyMultipleLevenshtein(currentStmt.expression, listLevenshtein);
    // if (!determineSameExpressionLevenshtein(applyres, newTable)) {
    //     const print2 = `last-turn expression   : ${currentStmt.expression.prettyprint()}\n`;
    //     const print3 = `levenshtein expressions: ${listLevenshtein.map((i) => i.prettyprint())}\n`;
    //     const print4 = `applied result         : ${applyres.prettyprint()}\n`;
    //     const print5 = `expected expression    : ${newTable.prettyprint()}\n`;
    //     appendFileSync("/Users/shichengliu/Desktop/Monica_research/workdir/levenshtein_debug/listProposalSearchQuestionReply_multiwoz.txt", print2 + print3 + print4 + print5);
    // }
    C.levenshteinDebugOutput(applyres, newTable, "listProposalSearchQuestionReply_multiwoz.txt");



    return addQuery(ctx, 'execute', newTable, 'accepted');
}

function corefConstant(ctx : ContextInfo, base : Ast.Expression, param : C.ParamSlot) {
    const previous = ctx.previousDomain;
    assert(previous);
    if (!previous.results || previous.results.results.length === 0)
        return null;
    const ctxStmt = previous.stmt;
    const ctxSchema = ctxStmt.expression.schema!;
    if (!ctxSchema.class) // FIXME not sure how this happens...
        return null;
    if (ctxSchema.class.name !== base.schema!.class!.name)
        return null;
    if (!C.isSameFunction(ctxSchema, param.schema))
        return null;
    const result = previous.results.results[0];
    if (!result.value[param.name])
        return null;
    return result.value[param.name];
}

function booleanQuestion(base : Ast.Expression|null, slot : C.FilterSlot) : C.ParamSlot[]|null {
    if (base !== null) {
        if (!C.isSameFunction(base.schema!, slot.schema))
            return null;
    }

    const ast = slot.ast;
    if (!(ast instanceof Ast.AtomBooleanExpression)) {
        assert(ast instanceof Ast.AndBooleanExpression);
        assert(ast.operands.length === 2);
        const [op1, op2] = [ast.operands[0], ast.operands[1]];
        assert(op1 instanceof Ast.AtomBooleanExpression);
        assert(op2 instanceof Ast.AtomBooleanExpression);
        assert(op1.name === op2.name);
        return [{
            schema: slot.schema,
            type: slot.ptype,
            filterable: slot.schema.getArgument(op1.name)!.getImplementationAnnotation<boolean>('filterable') ?? true,
            symmetric: slot.schema.getArgument(op1.name)!.getImplementationAnnotation<boolean>('symmetric') ?? false,
            name: op1.name,
            ast: new Ast.Value.VarRef(op1.name)
        }];
    }
    if (ast.name === 'id')
        return null;
    return [{
        schema: slot.schema,
        type: slot.ptype,
        filterable: slot.schema.getArgument(ast.name)!.getImplementationAnnotation<boolean>('filterable') ?? true,
        symmetric: slot.schema.getArgument(ast.name)!.getImplementationAnnotation<boolean>('symmetric') ?? false,
        name: ast.name,
        ast: new Ast.Value.VarRef(ast.name),
    }];
}

export {
    recommendationSearchQuestionReply,
    displayResultSearchQuestionReply,
    learnMoreSearchQuestionReply,
    listProposalSearchQuestionReply,
    corefConstant,
    booleanQuestion
};
