// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const ThingTalk = require('thingtalk');
const SchemaRetriever = ThingTalk;

// Note that policies themselves might cyclically import this module to create new states
// so we need to be careful about import order and how the DialogueState class is exported
const POLICIES = require('./policies');

const { makeDummyEntity } = require('../utils');

/**
 * DlgThingTalk is a language for dialog states.
 * It is based on ThingTalk, and will likely move back to ThingTalk over time.
 *
 * Syntax:
 * ```
 * <dlg-type> <dlg-act> { <tt-program> [; <tt-program>]* } { <tt-program> [; <tt-program>]* }
 * ```
 *
 * - `<dlg-type>` is the type of dialogue (type of policy) to use; for now, only
 * "transaction" is supported
 * - `<dlg-act>` is the abstract dialog act that was last performed, either by the
 * agent or by the user
 * - `<tt-program>` the current program history and stack
 */
module.exports.DialogueState = class DialogueState {
    constructor(policy, dialogAct, programHistory, programStack) {
        this.dialogAct = dialogAct;
        this.history = programHistory;
        this.stack = programStack;

        this._policy = policy;
        this._delegate = policy.initState(this);
    }

    _ensureSchemaRetriever(options) {
        const tpClient = options.thingpediaClient;
        if (!options.schemaRetriever)
            options.schemaRetriever = new SchemaRetriever(tpClient, null, !options.debug);
    }

    _eatProgram(code, startIndex) {
        let endIndex = startIndex;
        let inString = false;
        let parenCount = 0;

        while (endIndex < code.length) {
            if (code[endIndex] === '"')
                inString = !inString;
            if (inString) {
                endIndex ++;
                continue;
            }
            if (code[endIndex] === '{') {
                parenCount ++;
                continue;
            } else if (code[endIndex] === '}') {
                if (parenCount === 0)
                    break;
                else
                    parenCount --;
            } else if (code[endIndex] === ';' && parenCount === 0) {
                break;
            }
            endIndex ++;
        }
        return endIndex;
    }

    static async parse(code, entities, options) {
        this._ensureSchemaRetriever();

        if (!Array.isArray(code))
            code = code.split(' ');

        let parserState = 'policy';
        let policy, dialogAct;
        const programHistory = [];
        const programStack = [];

        for (let i = 0; i < code.length; i++) {
            const token = code[i];

            switch (parserState) {
            case 'policy':
                if (!/^[a-z_]+$/.test(token) || !(token in POLICIES))
                    throw new Error(`Invalid policy ${token}`);
                policy = POLICIES[token];
                parserState = 'dialogAct';
                break;

            case 'dialogAct':
                if (!/^[a-z_]+$/.test(token) || !(token in POLICIES))
                    throw new Error(`Invalid dialog act ${token}`);
                dialogAct = token;
                parserState = 'history';
                break;

            case 'history': {
                if (token !== '{')
                    throw new Error(`Unexpected token ${token}, expected {`);
                let startIndex = i + 1;
                let endIndex = this._eatProgram(code, startIndex);
                if (endIndex >= code.length)
                    throw new Error(`Unexpected end of stream, expected } or ;`);
                if (endIndex > startIndex)
                    programHistory.push(await this._parseProgram(code.slice(startIndex, endIndex), entities, options));

                if (code[endIndex] === '}')
                    parserState = 'stack';
                i = endIndex;
                break;
            }

            case 'stack': {
                if (token !== '{')
                    throw new Error(`Unexpected token ${token}, expected {`);
                let startIndex = i + 1;
                let endIndex = this._eatProgram(code, startIndex);
                if (endIndex >= code.length)
                    throw new Error(`Unexpected end of stream, expected } or ;`);
                if (endIndex > startIndex)
                    programStack.push(await this._parseProgram(code.slice(startIndex, endIndex), entities, options));

                if (code[endIndex] === '}')
                    parserState = 'stack';
                i = endIndex;
                break;
            }
            }
        }

        return new DialogueState(policy, dialogAct, programHistory, programStack);
    }

    static async normalize(code, options) {
        const self = await DialogueState.parse(code, makeDummyEntity, options);
        return self.serialize();
    }

    async _parseProgram(programCode, entities, options) {
        const program = ThingTalk.NNSyntax.fromNN(programCode, entities);
        const schemas = options.schemaRetriever;
        await program.typecheck(schemas, false);
        return program;
    }

    _serializeProgram(program, sentence, entities, isLastProgram) {
        return ThingTalk.NNSyntax.toNN(program, sentence, entities, { allocateEntities: !isLastProgram });
    }

    serialize(sentence) {
        const code = [this.policy.name, this.dialogAct];

        const entities = {};
        code.push('{');
        for (let i = 0; i < this.history.length; i++) {
            const prog = this.history[i];
            code.push(...this._serializeProgram(prog, '', entities, false));
            if (i < this.history.length-1)
                code.push(';');
        }
        code.push('}');

        code.push('{');
        for (let i = 0; i < this.stack.length; i++) {
            const isLastProgram = i === this.stack.length-1;
            code.push(...this._serializeProgram(code, isLastProgram ? sentence : '', entities, isLastProgram));
            if (!isLastProgram)
                code.push(';');
        }
        code.push('}');

        return code;
    }
};
