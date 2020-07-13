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
const Type = ThingTalk.Type;

const {
    addQuery,
} = require('../state_manip');
const {
    queryRefinement,
    refineFilterToAnswerQuestion,
} = require('./refinement-helpers');


function areQuestionsValidForContext(ctx, questions) {
    for (const [qname, qtype] of questions) {
        assert(typeof qname === 'string');
        assert(qtype === null || qtype instanceof Type);
        if (!ctx.currentFunctionSchema.hasArgument(qname))
            return false;
        if (qtype !== null && !ctx.currentFunctionSchema.getArgType(qname).equals(qtype))
            return false;
    }
    return true;
}

function recommendationSearchQuestionReply(ctx, questions) {
    const proposal = ctx.aux;
    const { topResult, info, } = proposal;
    if (info !== null) {
        for (const [pname, ptype] of questions) {
            if (info.has(pname))
                return null;
            if (!info.schema.hasArgument(pname))
                return null;
            if (ptype !== null && !info.schema.getArgType(pname).equals(ptype))
                return null;
        }
    }

    if (!areQuestionsValidForContext(ctx, questions))
        return false;

    const currentTable = ctx.current.stmt.table;
    const newFilter = new Ast.BooleanExpression.Atom(null, 'id', '==', topResult.value.id);
    const newTable = queryRefinement(currentTable, newFilter, refineFilterToAnswerQuestion,
        questions.map(([qname, qtype]) => qname));
    if (newTable === null)
        return null;
    return addQuery(ctx, 'execute', newTable, 'accepted');
}

function learnMoreSearchQuestionReply(ctx, questions) {
    const topResult = ctx.results[0];
    if (!areQuestionsValidForContext(ctx, questions))
        return false;

    const currentTable = ctx.current.stmt.table;
    const newFilter = new Ast.BooleanExpression.Atom(null, 'id', '==', topResult.value.id);
    const newTable = queryRefinement(currentTable, newFilter, refineFilterToAnswerQuestion,
        questions.map(([qname, qtype]) => qname));
    if (newTable === null)
        return null;
    return addQuery(ctx, 'execute', newTable, 'accepted');
}

function listProposalSearchQuestionReply(ctx, [name, questions]) {
    const proposal = ctx.aux;
    const [results, info] = proposal;

    if (name !== null) {
        let good = false;
        for (let result of results) {
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
        for (let [pname, type] of questions) {
            assert(typeof pname === 'string');
            if (info.has(pname))
                return null;
            if (!info.schema.hasArgument(pname))
                return null;
            if (type !== null && !info.schema.getArgType(pname).equals(type))
                return null;
        }
    }

    if (!areQuestionsValidForContext(ctx, questions))
        return false;

    const currentTable = ctx.current.stmt.table;
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

module.exports = {
    recommendationSearchQuestionReply,
    learnMoreSearchQuestionReply,
    listProposalSearchQuestionReply
};
