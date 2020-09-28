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

import assert from 'assert';

import * as ThingTalk from 'thingtalk';
const SchemaRetriever = ThingTalk.SchemaRetriever;

import SimulationDialogueAgent from '../../dialogue-agent/simulator/simulation_dialogue_agent';
import { computeNewState, computePrediction, prepareContextForPrediction } from '../../dialogue-agent/dialogue_state_utils';
import { extractConstants, createConstants } from './constants';
import { parse, parsePrediction, serialize, serializeNormalized, serializePrediction } from './syntax';

export {
    parse,
    parsePrediction,
    serialize,
    serializeNormalized,
    serializePrediction,

    extractConstants,
    createConstants,

    computeNewState,
    computePrediction,
    prepareContextForPrediction
};

export function validateState(state, forTarget) {
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
}

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



export function createSimulator(options = {}) {
    const tpClient = options.thingpediaClient;
    if (!options.schemaRetriever)
        options.schemaRetriever = new SchemaRetriever(tpClient, null, true);
    return new SimulationDialogueAgent(options);
}
