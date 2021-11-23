// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020-2021 The Board of Trustees of the Leland Stanford Junior University
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

import assert from 'assert';
import { Ast } from 'thingtalk';

import type { PolicyModule } from './policy';

function validateState(state : Ast.DialogueState, forTarget : 'user'|'agent') : void {
    if (forTarget === 'user') {
        // check that there are no 'proposed' items
        // (should be executed, 'accepted' or 'confirmed')
        for (const item of state.history)
            assert(item.confirm !== 'proposed');
    } else {
        // check that there are no 'confirmed' items that were not executed
        // TODO: if we add "intermediate_context" capabilities to the state machine
        // we can relax this restriction
        for (const item of state.history)
            assert(item.confirm !== 'confirmed' || item.results !== null);
    }
}

/**
 * A faster version of PolicyManifest that uses sets instead of arrays.
 */
interface SetPolicyManifest {
    name : string;
    terminalAct : string;
    dialogueActs : {
        user : Set<string>;
        agent : Set<string>;
        withParam : Set<string>;
    };
}
type PolicyManifest = PolicyModule['MANIFEST'];

export class StateValidator {
    private _policy : SetPolicyManifest;

    constructor(policy : PolicyManifest) {
        this._policy = {
            name: policy.name,
            terminalAct: policy.terminalAct,
            dialogueActs: {
                user: new Set(policy.dialogueActs.user),
                agent: new Set(policy.dialogueActs.agent),
                withParam: new Set(policy.dialogueActs.withParam)
            }
        };
    }

    validateUser(state : Ast.DialogueState) : void {
        validateState(state, 'user');

        if (!this._policy)
            return;
        assert.strictEqual(state.policy, this._policy.name);
        assert(this._policy.dialogueActs.user.has(state.dialogueAct), `Invalid user dialogue act ${state.dialogueAct}`);
        // if and only if
        assert((state.dialogueActParam !== null) === (this._policy.dialogueActs.withParam.has(state.dialogueAct)));
    }

    validateAgent(state : Ast.DialogueState) : void {
        validateState(state, 'agent');

        if (!this._policy)
            return;
        assert.strictEqual(state.policy, this._policy.name);
        assert(this._policy.dialogueActs.agent.has(state.dialogueAct), `Invalid agent dialogue act ${state.dialogueAct}`);
        // if and only if
        assert((state.dialogueActParam !== null) === (this._policy.dialogueActs.withParam.has(state.dialogueAct)));
    }
}
