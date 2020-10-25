// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
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


import * as Ast from './ast';
import type { EntityMap } from '../../utils/entity-utils';

export async function parse(code : string|string[], entities ?: EntityMap, options ?: unknown) : Promise<Ast.DialogState> {
    const dialoguestate = new Ast.DialogState;

    let parserState = 'intent';
    let tokens : string[];
    if (typeof code === 'string')
        tokens = code.split(' ');
    else
        tokens = code;

    const currentBuffer : string[] = [];
    let currentSlotKey : string|undefined = undefined;
    let currentIsMaybe = false;

    for (const token of tokens) {
        switch (parserState) {
        case 'end':
            throw new Error(`Unexpected token ${token} in state ${parserState}`);

        case 'intent':
            dialoguestate.intent = token;
            if (!Ast.INTENTS.has(dialoguestate.intent))
                throw new Error(`Invalid intent ${dialoguestate.intent}`);

            if (token === 'null' || token === 'greet')
                parserState = 'end';
            else
                parserState = 'domain';
            break;

        case 'domain':
            dialoguestate.domain = token;
            parserState = 'begin';
            break;

        case 'begin':
            if (['"', 'is', 'yes', 'no', 'dontcare', 'none', 'maybe', '?'].includes(token) || token.startsWith('SLOT_'))
                throw new Error(`Unexpected token ${token} in state ${parserState}`);
            currentBuffer.push(token);
            parserState = 'name';
            break;

        case 'name':
            if (['"', 'yes', 'no', 'dontcare', 'none', 'maybe', '?'].includes(token))
                throw new Error(`Unexpected token ${token} in state ${parserState}`);
            if (token === 'is')
                parserState = 'maybe';
            else
                currentBuffer.push(token);
            break;

        case 'maybe':
            if ('maybe' === token) {
                currentIsMaybe = true;
                parserState = 'is';
                break;
            }
            // fallthrough

        case 'is':
            currentSlotKey = currentBuffer.join('-');
            currentBuffer.length = 0;
            if ('?' === token) {
                dialoguestate.set(currentSlotKey, Ast.QUESTION);
                parserState = 'begin';
            } else if (token === 'yes' || token === 'no' || token === 'dontcare') {
                let value : Ast.Value = new Ast.TristateValue(token);
                if (currentIsMaybe)
                    value = new Ast.MaybeValue(value);
                dialoguestate.set(currentSlotKey, value);
                currentIsMaybe = false;
                parserState = 'begin';
            } else if (token.startsWith('SLOT_')) {
                let value : Ast.Value = new Ast.SlotValue(token);
                if (currentIsMaybe)
                    value = new Ast.MaybeValue(value);
                dialoguestate.set(currentSlotKey, value);
                currentIsMaybe = false;
                parserState = 'begin';
            } else {
                if (token !== '"')
                    throw new Error(`Unexpected token ${token} in state ${parserState}`);
                parserState = 'string';
            }
            break;

        case 'string':
            if (token === '"') {
                let value : Ast.Value = new Ast.ConstantValue(currentBuffer.join(' '));
                if (currentIsMaybe)
                    value = new Ast.MaybeValue(value);
                dialoguestate.set(currentSlotKey!, value);
                currentBuffer.length = 0;
                currentIsMaybe = false;
                parserState = 'begin';
            } else {
                currentBuffer.push(token);
            }
        }
    }

    if (parserState !== 'begin' && parserState !== 'end')
        throw new Error(`Unexpected end-of-stream in state ${parserState}`);

    if ((dialoguestate.intent === 'null' || dialoguestate.intent === 'greet') &&
        dialoguestate.size !== 0)
        throw new Error(`${dialoguestate.intent} expected no slots`);

    return dialoguestate;
}

class Simulator {
    constructor() {}

    /**
     * Execute the query or action implied by the current dialogue state.
     *
     * This method should return a new dialogue state with filled information
     * about the result. It should not modify the state in-place.
     *
     * @param {any} state - the current state, representing the query or action to execute
     * @return {ant} - the new state, with information about the returned query or action
     */
    async execute(state : Ast.DialogState) : Promise<[Ast.DialogState, undefined, boolean]> {
        // the dialogue state already encodes enough information to choose the system utterance,
        // because we choose randomly the number of results and what those results look like
        return [state.clone(), undefined, false];
    }
}

export function serialize(ast : Ast.DialogState, sentence : string[], entities : EntityMap) : string[] {
    return ast.prettyprint().split(' ');
}

export function serializeNormalized(ast : Ast.DialogState) : [string[], EntityMap] {
    return [ast.prettyprint().split(' '), {}];
}

// multidst does not use constants
export function extractConstants(ast : Ast.DialogState) : { [key : string] : never } {
    return {};
}
export function createConstants(type : string) : undefined[] {
    return [];
}

export async function normalize(code : string|string[], options ?: unknown) : Promise<string> {
    try {
        return (await parse(code)).prettyprint();
    } catch(e) {
        console.error(code);
        throw e;
    }
}

/**
 * Compute the information that the neural network interpreting the user input
 * must predict, to compute new state.
 *
 * This should return a string representation, roughly corresponding to the
 * delta between `oldState` and `newState`.
 * Neither `oldState` nor `newState` must be modified in-place.
 *
 * @param {any} oldState - the previous dialogue state, before the user speaks
 * @param {any} newState - the new state of the dialogue, after the user speaks
 * @return {any} - the delta to predict
 */
export function computePrediction(oldState : Ast.DialogState|null, newState : Ast.DialogState, forTarget : 'user'|'agent') : Ast.DialogState {
    // always predict newState a-new
    return newState;
}

export function serializePrediction(prediction : Ast.DialogState, sentence : string[], entities : EntityMap, forTarget : 'user'|'agent') : string[] {
    if (forTarget === 'user')
        return prediction.prettyprint().split(' ');
    else // we don't care about the agent dialogue policy in this task
        return [];
}

export function createSimulator() : Simulator {
    return new Simulator();
}

class StateValidator {
    async load() {
    }

    validateUser(state : Ast.DialogState) {
    }

    validateAgent(state : Ast.DialogState) {
    }
}

export function createStateValidator(policyManifest ?: string) : StateValidator {
    return new StateValidator();
}
