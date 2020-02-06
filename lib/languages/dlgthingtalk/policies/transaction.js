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

//const ThingTalk = require('thingtalk');
//const Ast = ThingTalk.Ast;

// Transaction Dialog Policy: execute one or more related ThingTalk program, with
// nested slot-filling

module.exports = {
    DIALOG_ACTS: new Set([
        // user dialog acts

        // user says hi!
        'greet',
        // user issues a ThingTalk program
        'program',


        // system dialog acts

        // agent says hi back
        'sys_greet',
        // agent asks a question
        'slot_fill'
    ]),

    /**
     * Prepare the dialogue state to choose the next dialogue act.
     *
     * This method executes the ThingTalk code and ensures that all programs
     * that can be executed have been executed.
     *
     * @param {ThingTalk.Ast.DialogueState} user state - the current state after the user spoke
     * @param {AbstractThingTalkExecutor} executor - how to execute ThingTalk code
     * @param {RandomGenerator} [rng=Math.random] - random number generator
     * @return {ThingTalk.Ast.DialogueState} agent state - the current state before the agent speaks
     */
    prepareForNextAgentAct(state, executor, rng = Math.random) {
        return undefined;
    },

    /**
     * Choose the next dialogue act in the current dialogue state.
     *
     * @param {ThingTalk.Ast.DialogueState} agent state - the current state when the agent is about to speak
     * @param {RandomGenerator} [rng=Math.random] - random number generator
     * @return {ThingTalk.Ast.DialogueState} final state - the current state after the agent spoke
     */
    nextDialogueAct(state, rng = Math.random) {
        return undefined;
    },

    /**
     * Compute the new dialogue state at the end of the user utterance, given the
     * current dialogue state and the output of the neural network.
     *
     * This should return a new state object, and must not modify `state`.
     *
     * This is the inverse operation to {@link #computePrediction}.
     *
     * @param {ThingTalk.Ast.DialogueState} state - the previous state of the dialogue
     * @param {ThingTalk.Ast.DialogueState} prediction - the output of the neural network, parsed
     * @return {ThingTalk.Ast.DialogueState} - the current state of the dialogue
     */
    computeNewState(state, prediction) {
        return undefined;
    },
};
