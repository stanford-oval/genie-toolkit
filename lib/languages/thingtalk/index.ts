// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
import yaml from 'js-yaml';
import util from 'util';
import * as fs from 'fs';

import { Ast, SchemaRetriever } from 'thingtalk';

import SimulationDialogueAgent, { SimulationDialogueAgentOptions } from '../../dialogue-agent/simulator/simulation_dialogue_agent';
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

export function createSimulator(options : SimulationDialogueAgentOptions) : SimulationDialogueAgent {
    const tpClient = options.thingpediaClient;
    if (!options.schemaRetriever)
        options.schemaRetriever = new SchemaRetriever(tpClient, null, true);
    return new SimulationDialogueAgent(options);
}

interface PolicyManifest {
    name : string;
    terminalAct : string;
    dialogueActs : {
        user : Set<string>;
        agent : Set<string>;
        withParam : Set<string>;
    };
}

class StateValidator {
    private _policyManifest : string|undefined;
    private _policy : PolicyManifest|null;

    constructor(policyManifest : string|undefined) {
        this._policyManifest = policyManifest;
        this._policy = null;
    }

    async load() : Promise<void> {
        if (!this._policyManifest)
            return;
        const buffer = await util.promisify(fs.readFile)(this._policyManifest, { encoding: 'utf8' });
        const policy = yaml.safeLoad(buffer) as any;

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
        assert(this._policy.dialogueActs.user.has(state.dialogueAct));
        // if and only if
        assert((state.dialogueActParam !== null) === (this._policy.dialogueActs.withParam.has(state.dialogueAct)));
    }

    validateAgent(state : Ast.DialogueState) : void {
        validateState(state, 'agent');

        if (!this._policy)
            return;
        assert.strictEqual(state.policy, this._policy.name);
        assert(this._policy.dialogueActs.user.has(state.dialogueAct));
        assert(state.dialogueAct !== this._policy.terminalAct);
        // if and only if
        assert((state.dialogueActParam !== null) === (this._policy.dialogueActs.withParam.has(state.dialogueAct)));
    }
}

export function createStateValidator(policyManifest ?: string) : StateValidator {
    return new StateValidator(policyManifest);
}
