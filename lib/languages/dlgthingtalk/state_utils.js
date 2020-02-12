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

    // This assertion (and the one below) does not hold in case of
    //
    // $dialogue @org.thingpedia.dialogue.transaction.sys_propose_refined_query;
    // now => (@uk.ac.cam.multiwoz.Restaurant.Restaurant()), (...) => notify
    // #[results=[...]];
    // #[count=108]
    // now => (result(@uk.ac.cam.multiwoz.Restaurant.Restaurant[1])), id == "str:ENTITY_uk.ac.cam.multiwoz.Restaurant:Restaurant::9"^^uk.ac.cam.multiwoz.Restaurant:Restaurant => notify;
    // now => @uk.ac.cam.multiwoz.Restaurant.make_reservation(restaurant=$?, book_time=$?, book_day=$?, book_people=$?);
    //
    // in that case, the previous state (the context) includes the first and third program
    // so the first program in the prediction (the `result()` program) is not
    // compatible with the action
    //
    // the next state (the user prediction) includes a modified first program and the third program
    // it has length two, which is less than the length of the current state
    //
    //assert(newState.history.length >= oldState.history.length);

    const deltaState = new Ast.DialogueState(null, newState.policy, newState.dialogueAct, newState.dialogueActParam, []);

    // walk forward through both states until we find a history item that is not equal
    let i = 0;
    while (i < Math.min(newState.history.length, oldState.history.length)) {
        if (!oldState.history[i].equals(newState.history[i]))
            break;
        i++;
    }
    /*if (i < oldState.history.length)
        assert(newState.history[i].compatible(oldState.history[i]));
    */

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
    if (state === null)
        return prediction;

    // walk backwards through state until we find an history item that is compatible with
    // the first program in the prediction, then override everything else afterwards

    const clone = new Ast.DialogueState(null, prediction.policy, prediction.dialogueAct, prediction.dialogueActParam, state.history.slice());
    if (prediction.history.length === 0)
        return clone;

    /*console.log();
    console.log('--- computeNewState');
    console.log(clone.prettyprint());
    console.log(prediction.prettyprint());
    */

    for (let i = clone.history.length-1; i >= 0; i--) {
        const item = clone.history[i];

        const j = prediction.history.length - (clone.history.length-i);
        if (j >= 0 && item.compatible(prediction.history[j])) {
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
