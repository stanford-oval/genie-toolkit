// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Ast = require('./ast');

async function parse(code, entities, options) {
    const dialoguestate = new Ast.DialogState;

    let parserState = 'intent';
    if (typeof code === 'string')
        code = code.split(' ');

    let currentBuffer = [];
    let currentSlotKey = undefined;
    let currentIsMaybe = false;

    for (let token of code) {
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
            } else if (['yes', 'no', 'dontcare', 'none'].includes(token)) {
                let value = new Ast.TristateValue(token);
                if (currentIsMaybe)
                    value = new Ast.MaybeValue(value);
                dialoguestate.set(currentSlotKey, value);
                currentIsMaybe = false;
                parserState = 'begin';
            } else if (token.startsWith('SLOT_')) {
                let value = new Ast.SlotValue(token);
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
                let value = new Ast.ConstantValue(currentBuffer.join(' '));
                if (currentIsMaybe)
                    value = new Ast.MaybeValue(value);
                dialoguestate.set(currentSlotKey, value);
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
    execute(state) {
        // the dialogue state already encodes enough information to choose the system utterance,
        // because we choose randomly the number of results and what those results look like
        return state.clone();
    }
}

module.exports = {
    parse,

    serialize(ast, sentence, entities) {
        return ast.prettyprint().split(' ');
    },

    serializeNormalized(ast) {
        return [ast.prettyprint().split(' '), {}];
    },

    // multidst does not use constants
    extractConstants(ast) {
        return {};
    },
    createConstants(type) {
        return [];
    },

    async normalize(code, options) {
        try {
            return (await parse(code)).prettyprint();
        } catch(e) {
            console.error(code);
            throw e;
        }
    },

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
    computePrediction(oldState, newState, forTarget) {
        // always predict newState a-new
        return newState;
    },

    serializePrediction(prediction, sentence, entities, forTarget) {
        if (forTarget === 'user')
            return prediction.prettyprint().split(' ');
        else // we don't care about the agent dialogue policy in this task
            return [];
    },

    createSimulator() {
        return new Simulator();
    }
};
