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
const NNSyntax = ThingTalk.NNSyntax;

const { makeDummyEntity } = require('../../utils');

const ThingTalkSimulator = require('./simulator');
const DialogueAgent = require('./agent');
const { computePrediction } = require('./state_utils');

module.exports = {
    async parse(code, entities, options) {
        const state = ThingTalk.NNSyntax.fromNN(code, entities);
        assert(state instanceof Ast.DialogueState);

        const tpClient = options.thingpediaClient;
        if (!options.schemaRetriever)
            options.schemaRetriever = new SchemaRetriever(tpClient, null, !options.debug);
        const schemas = options.schemaRetriever;
        await state.typecheck(schemas, false);
        return state;
    },

    serialize(ast, sentence, entities) {
        const clone = {};
        Object.assign(clone, entities);

        const sequence = NNSyntax.toNN(ast, sentence, clone, { typeAnnotations: false });
        //ThingTalk.NNSyntax.fromNN(sequence, {});

        if (sequence.some((t) => t.endsWith(':undefined')))
            throw new TypeError(`Generated undefined type`);

        return sequence;
    },

    serializeNormalized(program) {
        const entities = {};
        const code = ThingTalk.NNSyntax.toNN(program, '', entities, { allocateEntities: true, typeAnnotations: false }).join(' ');
        return [code, entities];
    },

    async normalize(code, options) {
        try {
            const program = ThingTalk.NNSyntax.fromNN(code.split(' '), makeDummyEntity);
            await program.typecheck(options.schemaRetriever, false);

            const entities = {};
            return ThingTalk.NNSyntax.toNN(program, '', entities, { allocateEntities: true, typeAnnotations: false }).join(' ');
        } catch(e) {
            console.error(code);
            throw e;
        }
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
     * @return {string[]} - the delta to predict, as a sequence of tokens
     */
    computeUserPrediction(oldState, newState) {
        return computePrediction(oldState, newState);
        // FIXME
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
     * @return {string[]} - the delta to predict, as a sequence of tokens
     */
    computeSystemPrediction(oldState, newState) {
        return computePrediction(oldState, newState);
        // FIXME
    },

    createSimulator(options) {
        return new DialogueAgent(new ThingTalkSimulator(options), options);
    }
};
