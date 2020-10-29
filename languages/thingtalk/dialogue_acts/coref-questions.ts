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

import { Ast, Type } from 'thingtalk';

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


function areQuestionsValidForContext(ctx : ContextInfo, questions : Array<[string, Type|null]>) {
    if (ctx.resultInfo!.isAggregation)
        return null;

    const schema = ctx.currentFunctionSchema!;

    // if the function only contains one parameter, do not generate projection for it
    if (Object.keys(schema.out).length === 1)
        return null;

    for (const [qname, qtype] of questions) {
        assert(typeof qname === 'string');
        assert(qtype === null || qtype instanceof Type);
        const arg = schema.getArgument(qname);
        if (!arg || arg.is_input)
            return false;
        if (qtype !== null && !arg.type.equals(qtype))
            return false;
    }
    return true;
}

function recommendationSearchQuestionReply(ctx : ContextInfo, questions : Array<[string, Type|null]>) {
    const proposal = ctx.aux as Recommendation;
    const { topResult, info, } = proposal;
    if (info !== null) {
        for (const [pname, ptype] of questions) {
            if (info.has(pname))
                return null;
                const arg = info.schema!.getArgument(pname);
                if (!arg)
                    return null;
                if (ptype !== null && !arg.type.equals(ptype))
                    return null;
        }
    }

    if (!areQuestionsValidForContext(ctx, questions))
        return null;

    const currentStmt = ctx.current!.stmt;
    assert(currentStmt instanceof Ast.Command);
    const currentTable = currentStmt.table!;
    const newFilter = new Ast.BooleanExpression.Atom(null, 'id', '==', topResult.value.id);
    const newTable = queryRefinement(currentTable, newFilter, refineFilterToAnswerQuestion,
        questions.map(([qname, qtype]) => qname));
    if (newTable === null)
        return null;
    return addQuery(ctx, 'execute', newTable, 'accepted');
}

function learnMoreSearchQuestionReply(ctx : ContextInfo, questions : Array<[string, Type|null]>) {
    const topResult = ctx.results![0];
    if (!areQuestionsValidForContext(ctx, questions))
        return null;

    const currentStmt = ctx.current!.stmt;
    assert(currentStmt instanceof Ast.Command);
    const currentTable = currentStmt.table!;
    const newFilter = new Ast.BooleanExpression.Atom(null, 'id', '==', topResult.value.id);
    const newTable = queryRefinement(currentTable, newFilter, refineFilterToAnswerQuestion,
        questions.map(([qname, qtype]) => qname));
    if (newTable === null)
        return null;
    return addQuery(ctx, 'execute', newTable, 'accepted');
}

function displayResultSearchQuestionReply(ctx : ContextInfo, questions : Array<[string, Type|null]>) {
    if (!areQuestionsValidForContext(ctx, questions))
        return null;

    const currentStmt = ctx.current!.stmt;
    assert(currentStmt instanceof Ast.Command);
    const currentTable = currentStmt.table!;
    const newTable = queryRefinement(currentTable, null, refineFilterToAnswerQuestion,
        questions.map(([qname, qtype]) => qname));
    if (newTable === null)
        return null;
    return addQuery(ctx, 'execute', newTable, 'accepted');
}

function listProposalSearchQuestionReply(ctx : ContextInfo, [name, questions] : [Ast.Value|null, Array<[string, Type|null]>]) {
    const proposal = ctx.aux as ListProposal;
    const [results, info] = proposal;

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
        for (const [pname, type] of questions) {
            assert(typeof pname === 'string');
            if (info.has(pname))
                return null;
            const arg = info.schema!.getArgument(pname);
            if (!arg)
                return null;
            if (type !== null && !arg.type.equals(type))
                return null;
        }
    }

    if (!areQuestionsValidForContext(ctx, questions))
        return null;

    const currentStmt = ctx.current!.stmt;
    assert(currentStmt instanceof Ast.Command);
    const currentTable = currentStmt.table!;
    let newTable;
    if (name !== null) {
        const newFilter = new Ast.BooleanExpression.Atom(null, 'id', '==', name);
        newTable = queryRefinement(currentTable, newFilter, refineFilterToAnswerQuestion,
            questions.map(([qname, qtype]) => qname));
    } else {
        newTable = queryRefinement(currentTable, null, null,
            questions.map(([qname, qtype]) => qname));
    }
    if (newTable === null)
        return null;

    return addQuery(ctx, 'execute', newTable, 'accepted');
}

function corefConstant(ctx : ContextInfo, base : Ast.Table, param : Ast.VarRefValue) {
    const previous = ctx.previousDomain;
    assert(previous);
    if (!previous.results || previous.results.results.length === 0)
        return null;
    const ctxStmt = previous.stmt;
    assert(ctxStmt instanceof Ast.Command);
    const ctxSchema = ctxStmt.table ? ctxStmt.table.schema! : ctxStmt.actions[0].schema!;
    if (!(ctxSchema instanceof Ast.FunctionDef) || !ctxSchema.class) // FIXME not sure how this happens...
        return null;
    if (ctxSchema.class.name !== base.schema!.class!.name)
        return null;
    const result = previous.results.results[0];
    if (!result.value[param.name])
        return null;
    return result.value[param.name];
}

export {
    recommendationSearchQuestionReply,
    displayResultSearchQuestionReply,
    learnMoreSearchQuestionReply,
    listProposalSearchQuestionReply,
    corefConstant
};
