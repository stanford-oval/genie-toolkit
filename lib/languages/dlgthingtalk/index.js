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
const { computeNewState, computePrediction } = require('./state_utils');

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

    computeNewState(oldState, prediction) {
        return computeNewState(oldState, prediction);
    },

    /**
     * Compute the information that the neural network interpreting the user input
     * must predict, to compute new state.
     *
     * This should return a string representation, roughly corresponding to the
     * delta between `oldState` and `newState`. The string should be parseable with
     * .parse().
     * Neither `oldState` nor `newState` must be modified in-place.
     *
     * @param {ThingTalk.Ast.DialogueState} oldState - the previous dialogue state, before the user speaks
     * @param {ThingTalk.Ast.DialogueState} newState - the new state of the dialogue, after the user speaks
     * @param {string[]} sentence - the utterance from the user
     * @param {Object} entities - entities contained in the utterance from the user or the context
     * @return {string[]} - the delta to predict, as a sequence of tokens
     */
    computeUserPrediction(oldState, newState, sentence, entities) {
        const prediction = computePrediction(oldState, newState);
        return ThingTalk.NNSyntax.toNN(prediction, sentence, entities, { typeAnnotations: false });
    },

    /**
     * Compute the information that the neural network controlling the dialogue policy
     * must predict, to compute new state.
     *
     * This should return a new state object, roughly corresponding to the
     * delta between `oldState` and `newState`.
     * Neither `oldState` nor `newState` must be modified in-place.
     *
     * @param {ThingTalk.Ast.DialogueState} oldState - the previous dialogue state, before the system speaks
     * @param {ThingTalk.Ast.DialogueState} newState - the new state of the dialogue, after the system speaks
     * @param {string[]} sentence - the utterance from the agent
     * @param {Object} entities - entities contained in the utterance from the agent or the context
     * @return {string[]} - the delta to predict, as a sequence of tokens
     */
    computeAgentPrediction(oldState, newState, sentence, entities) {
        const prediction = computePrediction(oldState, newState);
        return ThingTalk.NNSyntax.toNN(prediction, sentence, entities, { allocateEntities: true, typeAnnotations: false });
    },

    createSimulator(options = {}) {
        const tpClient = options.thingpediaClient;
        if (!options.schemaRetriever)
            options.schemaRetriever = new SchemaRetriever(tpClient, null, !options.debug);
        return new DialogueAgent(new ThingTalkSimulator(options), options);
    },

    prepareContextForPrediction(context) {
        const clone = context.clone();

        for (let item of clone.history) {
            if (item.results === null)
                continue;

            // reduce the number of results that are shown so we don't confused the neural network too much
            if (item.results.results.length > 3)
                item.results.results.length = 3;
        }

        return clone;
    },
};
