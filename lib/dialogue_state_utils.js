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

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

// this code is shared with genie-toolkit
function computeNewState(state, prediction) {
    if (state === null)
        return prediction;

    // if there was a policy change, the new policy won't be able to interpret the old state
    // so wipe everything and start fresh
    if (prediction.policy !== state.policy)
        return prediction;

    // walk backwards through state until we find an history item that is compatible with
    // the first program in the prediction, then override everything else afterwards

    const clone = new Ast.DialogueState(null, prediction.policy, prediction.dialogueAct, prediction.dialogueActParam, state.history.slice());
    if (prediction.history.length === 0)
        return clone;

    /*
    console.log();
    console.log('--- computeNewState');
    console.log(clone.prettyprint());
    console.log(prediction.prettyprint());
    */

    for (let i = clone.history.length-1; i >= 0; i--) {
        const item = clone.history[i];
        if (item.compatible(prediction.history[0])) {
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
    computeNewState,
};
