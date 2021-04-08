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


import assert from 'assert';
import yaml from 'js-yaml';
import util from 'util';
import * as fs from 'fs';

import { Ast, SchemaRetriever } from 'thingtalk';

import SimulationDialogueAgent, { SimulationDialogueAgentOptions } from '../../dialogue-agent/simulator/simulation_dialogue_agent';
import { extractConstants, createConstants } from './constants';
export * from './describe';
export * from './syntax';
export * from './dialogue_state_utils';
import { computePrediction } from './dialogue_state_utils';
// reexport clean, tokenizeExample from misc-utils
import { clean, tokenizeExample } from '../misc-utils';
export { clean, tokenizeExample };

export type Input = Ast.Input;
export type DialogueState = Ast.DialogueState;
export type Simulator = SimulationDialogueAgent;
export type SimulatorOptions = SimulationDialogueAgentOptions;

export {
    extractConstants,
    createConstants,
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
        options.schemaRetriever = new SchemaRetriever(tpClient!, null, true);
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
        const policy = yaml.load(buffer) as any;

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

export function createStateValidator(policyManifest ?: string) : StateValidator {
    return new StateValidator(policyManifest);
}

interface DialoguePolicy {
    handleAnswer(state : Ast.DialogueState, value : Ast.Value) : Promise<Ast.DialogueState|null>;
}

export async function inputToDialogueState(policy : DialoguePolicy,
                                           context : Ast.DialogueState|null,
                                           input : Ast.Input) : Promise<Ast.DialogueState|null> {
    if (input instanceof Ast.ControlCommand) {
        if (context === null)
            return null;

        if (input.intent instanceof Ast.SpecialControlIntent) {
            switch (input.intent.type) {
            case 'yes':
            case 'no': {
                const value = new Ast.BooleanValue(input.intent.type === 'yes');
                const handled = await policy.handleAnswer(context, value);
                if (!handled)
                    return null;
                return computePrediction(context, handled, 'user');
            }
            default:
                return null;
            }
        }
        if (input.intent instanceof Ast.ChoiceControlIntent)
            return null;

        if (input.intent instanceof Ast.AnswerControlIntent) {
            const handled = await policy.handleAnswer(context, input.intent.value);
            if (!handled)
                return null;
            return computePrediction(context, handled, 'user');
        }

        throw new TypeError(`Unrecognized bookkeeping intent`);
    } else if (input instanceof Ast.Program) {
        // convert thingtalk programs to dialogue states so we can use "\t" without too much typing
        const prediction = new Ast.DialogueState(null, 'org.thingpedia.dialogue.transaction', 'execute', null, []);
        for (const stmt of input.statements) {
            if (stmt instanceof Ast.Assignment)
                throw new Error(`Unsupported: assignment statement`);
            prediction.history.push(new Ast.DialogueHistoryItem(null, stmt, null, 'accepted'));
        }
        return prediction;
    }

    assert(input instanceof Ast.DialogueState);
    return input;
}
