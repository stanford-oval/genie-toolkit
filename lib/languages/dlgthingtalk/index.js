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
const Ast = ThingTalk.Ast;
const SchemaRetriever = ThingTalk.SchemaRetriever;

const ThingTalkSimulator = require('./simulator');
const DialogueAgent = require('./agent');
const { computeNewState, computePrediction, prepareContextForPrediction } = require('./state_utils');

module.exports = {
    async parse(code, options) {
        const tpClient = options.thingpediaClient;
        if (!options.schemaRetriever)
            options.schemaRetriever = new SchemaRetriever(tpClient, null, !options.debug);

        assert(code);
        const state = await ThingTalk.Grammar.parseAndTypecheck(code, options.schemaRetriever, false);
        assert(state instanceof Ast.DialogueState);
        return state;
    },

    async parsePrediction(code, entities, options) {
        const tpClient = options.thingpediaClient;
        if (!options.schemaRetriever)
            options.schemaRetriever = new SchemaRetriever(tpClient, null, !options.debug);

        const schemas = options.schemaRetriever;
        try {
            if (typeof code === 'string')
                code = code.split(' ');
            const state = ThingTalk.NNSyntax.fromNN(code, entities);
            await state.typecheck(schemas, true);
            assert(state instanceof Ast.DialogueState);

            // convert the program to NN syntax once, which will force the program to be syntactically normalized
            // (and therefore rearrange slot-fill by name rather than Thingpedia order)
            ThingTalk.NNSyntax.toNN(state, '', {}, { allocateEntities: true });
            return state;
        } catch(e) {
            return null;
        }
    },

    serializeNormalized(program) {
        const entities = {};
        const code = ThingTalk.NNSyntax.toNN(program, '', entities, { allocateEntities: true, typeAnnotations: false });
        return [code, entities];
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

    /**
     * Convert the prediction to a sequence of tokens to predict.
     *
     * @param {ThingTalk.Ast.DialogueState} oldState - the previous dialogue state, before the turn
     * @param {ThingTalk.Ast.DialogueState} newState - the new state of the dialogue, after the turn
     * @param {string[]} sentence - the utterance spoken at this turn
     * @param {Object} entities - entities contained in the utterance or the context
     * @param {string} forTarget - who is speaking now: either `user` or `agent`
     * @return {string[]} - the delta to predict, as a sequence of tokens
     */
    serializePrediction(prediction, sentence, entities, forTarget) {
        return ThingTalk.NNSyntax.toNN(prediction, sentence, entities, { allocateEntities: forTarget === 'agent', typeAnnotations: false });
    },

    createSimulator(options = {}) {
        const tpClient = options.thingpediaClient;
        if (!options.schemaRetriever)
            options.schemaRetriever = new SchemaRetriever(tpClient, null, !options.debug);
        return new DialogueAgent(new ThingTalkSimulator(options), options);
    },

    prepareContextForPrediction(context, forTarget) {
        return prepareContextForPrediction(context, forTarget);
    },
};
