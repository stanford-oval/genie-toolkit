// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');

const ThingTalk = require('thingtalk');
const SchemaRetriever = ThingTalk.SchemaRetriever;

const StatementSimulator = require('../../dialogue-agent/execution/statement_simulator');
const DialogueExecutor = require('../../dialogue-agent/execution/dialogue_executor');
const { computeNewState, computePrediction, prepareContextForPrediction } = require('../../dialogue-agent/dialogue_state_utils');
const { extractConstants, createConstantsForDialogue, createConstantsForBasic } = require('./constants');
const { parse, parsePrediction, serialize, serializeNormalized, serializePrediction } = require('./syntax');

module.exports = {
    parse,
    parsePrediction,
    serialize,
    serializeNormalized,
    serializePrediction,

    extractConstants,
    createConstants(token, type, maxConstants, contextual) {
        if (contextual)
            return createConstantsForDialogue(token, type, maxConstants);
        else
            return createConstantsForBasic(token, type, maxConstants);
    },

    validateState(state, forTarget) {
        if (forTarget === 'user') {
            // check that there are no 'proposed' items
            // (should be executed, 'accepted' or 'confirmed')
            for (let item of state.history)
                assert(item.confirm !== 'proposed');
        } else {
            // check that there are no 'confirmed' items that were not executed
            // TODO: if we add "intermediate_context" capabilities to the state machine
            // we can relax this restriction
            for (let item of state.history)
                assert(item.confirm !== 'confirmed' || item.results !== null);
        }
    },

    computeNewState(oldState, prediction, forTarget) {
        return computeNewState(oldState, prediction, forTarget);
    },

    /**
     * Compute the information that the neural network must predict to compute the new state
     * in a turn.
     *
     * This applies to either the network interpreting the user input, the one controlling the
     * dialogue policy.
     *
     * This should return a new state, roughly corresponding to the
     * delta between `oldState` and `newState`.
     * Neither `oldState` nor `newState` must be modified in-place.
     *
     * @param {ThingTalk.Ast.DialogueState} oldState - the previous dialogue state, before the turn
     * @param {ThingTalk.Ast.DialogueState} newState - the new state of the dialogue, after the turn
     * @param {string} forTarget - who is speaking now: either `user` or `agent`
     */
    computePrediction(oldState, newState, forTarget) {
        return computePrediction(oldState, newState, forTarget);
    },

    createSimulator(options = {}) {
        const tpClient = options.thingpediaClient;
        if (!options.schemaRetriever)
            options.schemaRetriever = new SchemaRetriever(tpClient, null, true);
        return new DialogueExecutor(new StatementSimulator(options));
    },

    prepareContextForPrediction(context, forTarget) {
        return prepareContextForPrediction(context, forTarget);
    },
};
