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

const assert = require('assert');

const { isExecutable, shouldAutoConfirmStatement } = require('../dialogue_state_utils');

/**
 * Run the dialogue, executing ThingTalk for all statements.
 *
 * This is used both during simulation (when generating a dataset) and for
 * the real thing.
 */
class DialogueAgent {
    constructor(stmtexecutor) {
        this._executor = stmtexecutor;
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

        return [clone, privateState, anyChange];
    }
}
module.exports = DialogueAgent;
