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

const DialogState = require('../ast');

// Transaction Dialog Policy: execute one or more related ThingTalk program, with
// nested slot-filling

module.exports = {
    name: 'transaction',

    /**
     * Initialize a dialogue state object after parsing it.
     *
     * This should return a new object, that will be set as `state._delegate`.
     *
     * @param {DlgThingTalk.DialogueState} state - the newly parsed state
     * @return {any} delegate - the delegate object or policy-private data
     */
    initState(state) {
        return undefined;
    },

    /**
     * Compute the new dialogue state at the end of the user utterance, given the
     * current dialogue state and the output of the neural network.
     *
     * This should return a new state object, and must not modify `state`.
     *
     * @param {DlgThingTalk.DialogueState} state - the current state
     * @param {ThingTalk.Input} prediction - the output of the neural network, parsed
     * @return {DlgThingTalk.DialogueState} state - the new state of the dialogue
     */
    computeNewState(state, prediction) {
        const newState = new
    }
}
