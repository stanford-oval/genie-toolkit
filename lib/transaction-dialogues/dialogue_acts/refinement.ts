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

import * as C from '../../templates/ast_manip';
import { DialogueInterface, PolicyFunction } from '../../thingtalk-dialogues';

import { ContextInfo } from '../context-info';
import {
    addQuery,
} from '../state_manip';
import {
    makeAgentReply,
} from './common';
import {
    refineFilterToChangeFilter,
    refineFilterToAnswerQuestion,
    proposalReply
} from './refinement-helpers';
import * as Templates from '../templates/index.genie.out';
import * as CommonTemplates from '../../templates/common.genie.out';

// Refinement dialogue acts
//
// A proposal is when the agent proposed a refined search; the user answers:
// - some form of "yes"
// - some form of "no" followed by another search refinement

export type NegativeProposalReply = [Ast.Expression|null, Ast.Expression|null];

export function negativeProposalReplyKeyFn([preamble, request] : NegativeProposalReply) {
    assert(preamble || request);

    if (preamble && request)
        assert(C.isSameFunction(preamble.schema!, request.schema!));

    return {
        functionName: preamble ? preamble.schema!.qualifiedName : request!.schema!.qualifiedName
    };
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

export function searchResultPreamble(dlg : DialogueInterface, ctx : ContextInfo) {
    dlg.say(dlg._("{there are|i can see|i have found|i have} {{many|several} ${base[plural=other]}|${result_length} ${result_length:plural:one{${base[plural=one]}}other{${base[plural=other]}}}} {matching your request|matching your constraints|with those characteristics|like that|in my database}."), {
        base: CommonTemplates.base_noun_phrase.withConstraint(['functionName', ctx.key.currentFunction]),
        result_length: ctx.key.resultLength
    });
}

export function* systemGenericProposal(dlg : DialogueInterface, ctx : ContextInfo) : Iterable<PolicyFunction> {
    yield async () => {
        dlg.say(dlg._("{are you looking for a|how about a|how about the} ${proposal[plural=one]}"), {
            proposal: Templates.answer_noun_phrase.withConstraint(['functionName', ctx.key.currentFunction])
        }, (proposal : Ast.Expression) => makeRefinementProposal(ctx, proposal));
    };
    yield async () => {
        dlg.say(dlg._("{are you looking for|how about|how about} ${proposal}"), {
            proposal: Templates.anything_phrase.withConstraint(['functionName', ctx.key.currentFunction])
        }, (proposal : Ast.Expression) => makeRefinementProposal(ctx, proposal));
    };
    yield async () => {
        searchResultPreamble(dlg, ctx);
        dlg.say(dlg._("{are you looking for a|how about a|how about the} ${proposal[plural=one]}"), {
            proposal: Templates.answer_noun_phrase.withConstraint(['functionName', ctx.key.currentFunction])
        }, (proposal : Ast.Expression) => makeRefinementProposal(ctx, proposal));
    };
    yield async () => {
        searchResultPreamble(dlg, ctx);
        dlg.say(dlg._("{are you looking for|how about|how about} ${proposal}"), {
            proposal: Templates.anything_phrase.withConstraint(['functionName', ctx.key.currentFunction])
        }, (proposal : Ast.Expression) => makeRefinementProposal(ctx, proposal));
    };
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
    positiveProposalReply,
    negativeProposalReply,
};
