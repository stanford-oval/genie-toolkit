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

function computePrediction(oldState, newState) {
    if (oldState === null)
        return newState;

    assert(newState.history.length >= oldState.history.length);

    const deltaState = new Ast.DialogueState(null, newState.policy, newState.dialogueAct, newState.dialogueActParam, []);

    // walk forward through both states until we find a history item that is not equal
    let i = 0;
    while (i < oldState.history.length) {
        if (!oldState.history[i].equals(newState.history[i]))
            break;
        i++;
    }
    if (i < oldState.history.length)
        assert(newState.history[i].compatible(oldState.history[i]));

    deltaState.history = newState.history.slice(i);
    for (let i = 0; i < deltaState.history.length; i++) {
        if (deltaState.history[i].results !== null) {
            console.log(oldState.prettyprint());
            console.log(newState.prettyprint());
        }
        assert(deltaState.history[i].results === null);
    }
    return deltaState;
}

function computeNewState(state, prediction) {
    // walk backwards through state until we find an history item that is compatible with
    // the first program in the prediction, then override everything else afterwards

    const clone = new Ast.DialogueState(null, prediction.policy, prediction.dialogueAct, state.history.slice());
    if (prediction.history.length === 0)
        return clone;

    for (let i = clone.history.length-1; i >= 0; i--) {
        const item = clone.history[i];
        if (item.compatible(prediction.history[i])) {
            if (i > 0)
                clone.history = clone.history.slice(0, i-1).concat(prediction.history);
            else
                clone.history = prediction.history.slice();
            return clone;
        }
    }
    // if we did not find a compatible program, then append to the end
    clone.history.push(...prediction.history);
    return clone;
}

module.exports = {
    computePrediction,
    computeNewState,
};
