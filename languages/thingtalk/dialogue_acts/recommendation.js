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

const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const C = require('../ast_manip');

const { SlotBag, checkAndAddSlot } = require('../slot_bag');
const {
    getActionInvocation,
    makeAgentReply,
    makeSimpleState,
    addActionParam,
} = require('../state_manip');
const {
    isInfoPhraseCompatibleWithResult,
    findChainParam
} = require('./common');
const {
    refineFilterToAnswerQuestionOrChangeFilter,
    combinePreambleAndRequest,
    proposalReply
} = require('./refinement-helpers');
const {
    checkInfoPhrase
} = require('./results');


function makeActionRecommendation(ctx, action) {
    assert(action instanceof Ast.Invocation);

    const results = ctx.results;
    assert(results.length > 0);

    const topResult = results[0];
    const id = topResult.value.id;
    if (!id)
        return null;

    if (action.in_params.length !== 1)
        return null;

    for (let param of action.in_params) {
        if (param.value.equals(id))
            return { topResult, info: null, action };
    }

    return null;
}

function makeRecommendation(ctx, name) {
    const results = ctx.results;
    assert(results.length > 0);

    const topResult = results[0];
    const id = topResult.value.id;

    if (!id || !id.equals(name))
        return null;

    return { topResult, ctx, info: null, action: ctx.nextInfo && ctx.nextInfo.isAction ? getActionInvocation(ctx.next) : null };
}

function makeThingpediaRecommendation(ctx, info) {
    const results = ctx.results;
    assert(results.length > 0);

    const topResult = results[0];
    if (!isInfoPhraseCompatibleWithResult(topResult, info))
        return null;

    return { topResult, ctx, info, action: ctx.nextInfo && ctx.nextInfo.isAction ? getActionInvocation(ctx.next) : null };
}


function checkRecommendation({ topResult, action: nextAction }, info) {
    assert(info instanceof SlotBag);
    const resultType = topResult.value.id.getType();
    const idType = info.schema.getArgType('id');

    if (!idType || !idType.equals(resultType))
        return null;

    if (!isInfoPhraseCompatibleWithResult(topResult, info))
        return null;

    return { topResult, info, action: nextAction };
}

function checkActionForRecommendation({ topResult, info, action: nextAction }, action) {
    const resultType = topResult.value.id.getType();

    if (nextAction !== null) {
        if (!C.isSameFunction(nextAction.schema, action.schema))
            return null;
    }

    if (!C.hasArgumentOfType(action, resultType))
        return null;

    return { topResult, info, action };
}

// make a recommendation that looks like an answer, that is, "so and so is a ..."
function makeAnswerStyleRecommendation({ topResult, ctx, action }, filter) {
    let info = new SlotBag(ctx.currentFunctionSchema);
    info = checkAndAddSlot(info, filter);
    if (info === null)
        return null;
    info = checkInfoPhrase(ctx, info);
    if (info === null)
        return null;

    return checkRecommendation({ topResult, action }, info);
}

function makeRecommendationReply(ctx, proposal) {
    const { topResult, action } = proposal;
    if (action === null) {
        return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_recommend_one', null), proposal);
    } else {
        const chainParam = findChainParam(topResult, action);
        if (!chainParam)
            return null;
        return makeAgentReply(ctx, addActionParam(ctx, 'sys_recommend_one', action, chainParam, topResult.value.id, 'proposed'),
            proposal);
    }
}

function negativeRecommendationReply(ctx, [preamble, request]) {
    const proposal = ctx.aux;
    const { topResult, info, } = proposal;
    const proposalType = topResult.value.id.getType();
    request = combinePreambleAndRequest(preamble, request, info, proposalType);
    if (request === null)
        return null;
    return proposalReply(ctx, request, refineFilterToAnswerQuestionOrChangeFilter);
}

function positiveRecommendationReply(ctx, acceptedAction, name) {
    const proposal = ctx.aux;
    const { topResult, action: actionProposal } = proposal;

    if (acceptedAction === null) {
        // if the user did not give an action earlier, and no action
        // was proposed by the agent right now, the flow is roughly
        //
        // U: hello i am looking for a restaurant
        // A: how about the ... ?
        // U: sure I like that
        //
        // this doesn't make much sense, so we don't want this flow
        if (actionProposal === null)
            return null;

        acceptedAction = actionProposal;
    }

    if (actionProposal !== null && !C.isSameFunction(actionProposal.schema, acceptedAction.schema))
        return null;
    if (name !== null && !topResult.value.id.equals(name))
        return null;

    const chainParam = findChainParam(topResult, acceptedAction);
    if (!chainParam)
        return null;
    return addActionParam(ctx, 'execute', acceptedAction, chainParam, topResult.value.id, 'accepted');
}

function recommendationCancelReply(ctx, valid) {
    // see dialogue.genie for the meaning of this boolean
    if (!valid)
        return null;

    // "thank you" closes the dialogue
    // we cannot close the dialogue if we have pending actions
    if (ctx.next)
        return null;
    return makeSimpleState(ctx, 'cancel', null);
}

function recommendationLearnMoreReply(ctx, name) {
    const proposal = ctx.aux;
    const { topResult, } = proposal;
    if (name !== null && !topResult.value.id.equals(name))
        return null;
    return makeSimpleState(ctx, 'learn_more', null);
}

module.exports = {
    makeActionRecommendation,
    makeRecommendation,
    makeThingpediaRecommendation,
    makeAnswerStyleRecommendation,
    checkRecommendation,
    checkActionForRecommendation,
    makeRecommendationReply,

    positiveRecommendationReply,
    negativeRecommendationReply,
    recommendationCancelReply,
    recommendationLearnMoreReply,
};
