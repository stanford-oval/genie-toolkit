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
    makeAgentReply,
    addQuery,
} from '../state_manip';
import {
    refineFilterToChangeFilter,
    refineFilterToAnswerQuestion,
    proposalReply
} from './refinement-helpers';

export type NegativeProposalReply = [Ast.Expression|null, Ast.Expression|null];

export function negativeProposalReplyKeyFn([preamble, request] : NegativeProposalReply) {
    assert(preamble || request);

    if (preamble && request)
        assert(C.isSameFunction(preamble.schema!, request.schema!));

    return {
        functionName: preamble ? preamble.schema!.qualifiedName : request!.schema!.qualifiedName
    };
}

function checkSearchResultPreamble(ctx : ContextInfo, base : Ast.FunctionDef, num : Ast.Value|null, more : boolean) {
    if (!C.isSameFunction(base, ctx.currentFunction!))
        return null;
    if (num !== null) {
        if (!num.equals(ctx.current!.results!.count))
            return null;
        if (more !== ctx.current!.results!.more)
            return null;
    }

    return ctx;
}

/**
 * Agent act: the agent proposes to execute a different query statement (a refinement of
 * the current query).
 */
function makeRefinementProposal(ctx : ContextInfo, proposal : Ast.Expression) {
    // this if() can be false only with weird primitive templates
    if (!(proposal instanceof Ast.FilterExpression && proposal.expression instanceof Ast.InvocationExpression))
        return null;
    if (!C.isSameFunction(ctx.currentFunction!, proposal.schema!))
        return null;

    const currentStmt = ctx.current!.stmt;
    assert(currentStmt.stream === null);
    const ctxFilterTable = C.findFilterExpression(currentStmt.expression);
    if (ctxFilterTable === null)
        return null;

    const refinedFilter = refineFilterToAnswerQuestion(ctxFilterTable.filter, proposal.filter);
    if (refinedFilter === null)
        return null;

    const sysState = addQuery(ctx, 'sys_propose_refined_query', proposal, 'proposed');
    return makeAgentReply(ctx, sysState, proposal);
}

function negativeProposalReply(ctx : ContextInfo, [preamble, request] : [Ast.Expression|null, Ast.Expression|null]) {
    // discard if we have a preamble, because it's too complicated to check if the preamble is meaningful
    if (preamble !== null)
        return null;
    if (!(request instanceof Ast.FilterExpression))
        return null;

    const proposal = ctx.aux as Ast.FilterExpression;
    if (!C.isSameFunction(ctx.currentFunction!, request.schema!))
        return null;
    const refined = refineFilterToChangeFilter(proposal.filter, request.filter);
    if (refined === null)
        return null;

    return proposalReply(ctx, request, refineFilterToAnswerQuestion);
}

function positiveProposalReply(ctx : ContextInfo) {
    const proposal = ctx.aux as Ast.FilterExpression;
    return proposalReply(ctx, proposal, refineFilterToAnswerQuestion);
}

export {
    checkSearchResultPreamble,
    makeRefinementProposal,
    positiveProposalReply,
    negativeProposalReply,
};
