// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

// This is the policy for the "default" state of Almond, outside of any dialogue
// It is also the policy during "Train", "Choose Device" and "Entity Link". Those
// dialogue subroutines use "ask" or "askChoices" exclusively and bypass the dialogue loop.
module.exports = class NullPolicy {
    constructor() {
    }

    handleAnswer(value) {
        // This is only called in the default state (from askChoices, the askChoices code will
        // intercept the answer)
        //
        // Answers are not valid in the default state, so we return null
        return null;
    }

    chooseAction() {
        // The null policy is only used in dialogue helpers, so it should not query the policy
        throw new Error(`Code should not be reached`);
    }

    getInteractionState(dlg) {
        return {
            isTerminal: true,
            expect: null
        };
    }
};
