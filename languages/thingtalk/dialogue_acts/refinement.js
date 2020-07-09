// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const C = require('../ast_manip');

const {
    makeAgentReply,
    addQuery,
} = require('../state_manip');
const {
    refineFilterToChangeFilter,
    refineFilterToAnswerQuestion,
    proposalReply
} = require('./refinement-helpers');


function checkSearchResultPreamble(ctx, base, num, more) {
    if (base !== ctx.currentFunction)
        return null;
    if (num !== null) {
        if (!num.equals(ctx.current.count))
            return null;
        if (more !== ctx.current.more)
            return null;
    }

    return ctx;
}

/**
 * Agent act: the agent proposes to execute a different query statement (a refinement of
 * the current query).
 */
function makeRefinementProposal(ctx, proposal) {
    // this if() can be false only with weird primitive templates
    if (!(proposal.isFilter && proposal.table.isInvocation))
        return null;

    const ctxFilterTable = C.findFilterTable(ctx.current.stmt.table);
    if (ctxFilterTable === null)
        return null;

    const refinedFilter = refineFilterToAnswerQuestion(ctxFilterTable.filter, proposal.filter);
    if (refinedFilter === null)
        return null;

    const sysState = addQuery(ctx, 'sys_propose_refined_query', proposal, 'proposed');
    return makeAgentReply(ctx, sysState, proposal);
}

function negativeProposalReply(ctx, [preamble, request]) {
    // discard if we have a preamble, because it's too complicated to check if the preamble is meaningful
    if (preamble !== null)
        return null;

    const proposal = ctx.aux;
    if (!C.isSameFunction(ctx.currentFunctionSchema, request.schema))
        return null;
    const refined = refineFilterToChangeFilter(proposal.filter, request.filter);
    if (refined === null)
        return null;

    return proposalReply(ctx, request, refineFilterToAnswerQuestion);
}

function positiveProposalReply(ctx) {
    const proposal = ctx.aux;
    return proposalReply(ctx, proposal, refineFilterToAnswerQuestion);
}

module.exports = {
    checkSearchResultPreamble,
    makeRefinementProposal,
    positiveProposalReply,
    negativeProposalReply,
};
