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

const { isExecutable, shouldAutoConfirmStatement } = require('./state_utils');

/**
 * Run the dialogue, executing ThingTalk and invoking the policy at the
 * right time.
 *
 * This is used both during simulation (when generating a dataset) and for
 * the real thing.
 */
class DialogueAgent {
    constructor(executor, options) {
        this._rng = options.rng;
        this._executor = executor;
    }

    /**
     * Execute the query or action implied by the current dialogue state.
     *
     * This method should return a new dialogue state with filled information
     * about the result. It should not modify the state in-place.
     *
     * @param {Ast.DialogueState} state - the current state, representing the query or action to execute
     * @param {any} privateState - additional state carried by the dialogue agent (per dialogue)
     * @return {Ast.DialogueState} - the new state, with information about the returned query or action
     */
    async execute(state, privateState) {
        let anyChange = false;
        let clone = state;
        for (let i = 0; i < clone.history.length; i++) {
            if (clone.history[i].results !== null)
                continue;
            if (clone.history[i].confirm === 'accepted' &&
                isExecutable(clone.history[i].stmt) &&
                shouldAutoConfirmStatement(clone.history[i].stmt)) {
                if (!anyChange) {
                    clone = state.clone();
                    anyChange = true;
                }
                clone.history[i].confirm = 'confirmed';
            }
            if (clone.history[i].confirm !== 'confirmed')
                continue;
            assert(isExecutable(clone.history[i].stmt));

            if (!anyChange) {
                clone = state.clone();
                anyChange = true;
            }

            [clone.history[i].results, privateState] = await this._executor.executeStatement(clone.history[i].stmt, privateState);
        }

        return [clone, privateState];
    }
}
module.exports = DialogueAgent;
