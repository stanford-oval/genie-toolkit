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

const assert = require('assert');
const ThingTalk = require('thingtalk');
const SchemaRetriever = ThingTalk;

// Note that policies themselves might cyclically import this module to create new states
// so we need to be careful about import order and how the DialogueState class is exported
const POLICIES = require('./policies');

const { makeDummyEntity } = require('../../utils');

class ProgramHistoryItem {
    constructor(program) {
        assert(program instanceof ThingTalk.Ast.Input);
        this.program = program;
    }

    optimize() {
        this.program = this.program.optimize();
        if (this.program === null)
            return null;
        return this;
    }

    serialize(sentence, entities) {
        return ['{', ...ThingTalk.NNSyntax.toNN(this.program, sentence, entities, { allocateEntities: true }), '}'];
    }

    prettyprint() {
        return `{\n${this.program.prettyprint().trim()}\n}\n`;
    }
}

class ResultHistoryItem {
    constructor(results) {
        this.results = results;
    }

    optimize() {
        return this;
    }

    serialize() {
        // TODO
        return ['[', ']'];
    }

}

/**
 * DlgThingTalk is a language for dialog states.
 * It is based on ThingTalk, and will likely move back to ThingTalk over time.
 *
 * Syntax:
 * ```
 * <input> = <dlg-type> <dlg-act> <history-item>* { <tt-program> } { <tt-program>? }
 * <history-item> = { <tt-program> } | [ <result-item>* ]
 * <result-item> = { <result-key> , <result-key>* }
 * <result-key> = <pname> = <pvalue>
 * ```
 *
 * - `<dlg-type>` is the type of dialogue (type of policy) to use; for now, only
 * "transaction" is supported
 * - `<dlg-act>` is the abstract dialog act that was last performed, either by the
 * agent or by the user
 * - `<tt-program>` is a ThingTalk program
 *
 * At any time, the agent tracks the current program (that it will execute immediately,
 * if ready) and the optionally the program it will execute next (after the current one).
 */
module.exports.DialogueState = class DialogueState {
    constructor(policy, dialogAct, history, current, next) {
        this.dialogAct = dialogAct;
        this.history = history;
        this.current = current;
        this.next = next;

        if (typeof policy === 'string')
            policy = POLICIES[policy];
        this.policy = policy;
        this._delegate = policy.initState(this);
    }

    optimize() {
        this.history = this.history.map((prog) => prog.optimize()).filter((prog) => prog !== null);
        this.current = this.current ? this.current.optimize() : null;
        this.next = this.next ? this.next.optimize() : null;
        if (this.current === null && this.next !== null)
            return null;
        return this;
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
        const history = [];
        let current = null, next = null;

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
                if (!/^[a-z_]+$/.test(token) || !policy.DIALOG_ACTS.has(token))
                    throw new Error(`Invalid dialog act ${token}`);
                dialogAct = token;
                parserState = 'history';
                break;

            case 'history': {
                if (token === '[') {
                    parserState = 'resultList';
                    if (current !== null) {
                        history.push(new ProgramHistoryItem(current));
                        current = null;
                    }
                    if (next !== null) {
                        history.push(new ProgramHistoryItem(next));
                        next = null;
                    }
                    break;
                }

                if (token !== '{')
                    throw new Error(`Unexpected token ${token}, expected { or [`);
                let startIndex = i + 1;
                let endIndex = this._eatProgram(code, startIndex);
                if (endIndex >= code.length)
                    throw new Error(`Unexpected end of stream, expected }`);
                if (endIndex > startIndex) {
                    const program = await this._parseProgram(code.slice(startIndex, endIndex), entities, options);
                    if (next === null) {
                        next = program;
                    } else if (current === null) {
                        current = next;
                        next = program;
                    } else {
                        history.push(new ProgramHistoryItem(current));
                        current = next;
                        next = program;
                    }
                } else {
                    if (endIndex !== code.length - 1)
                        throw new Error(`Invalid empty program, must be the last in the sequence`);

                    // empty program
                    if (current === null) {
                        current = next;
                        next = null;
                    } else {
                        history.push(new ProgramHistoryItem(current));
                        current = next;
                        next = null;
                    }
                }
                i = endIndex;
                break;
            }

            case 'resultList': {
                // TODO
            }
            }
        }

        assert (current !== null || history.length === 0);
        assert (next === null || current !== null);
        return new DialogueState(policy, dialogAct, history, current, next);
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

    prettyprint() {
        let code = `${this.policy.name} ${this.dialogAct}\n`;
        for (let item of this.history)
            code += item.prettyprint();
        if (this.current)
            code += `{\n${this.current.prettyprint().trim()}\n}\n`;
        if (this.next)
            code += `{\n${this.next.prettyprint().trim()}\n}`;
        else
            code += '{}';
        return code;
    }

    serialize(sentence) {
        const code = [this.policy.name, this.dialogAct];

        const entities = {};
        for (let item of this.history)
            code.push(...item.serialize(sentence, entities));

        if (this.current)
            code.push('{', ...ThingTalk.NNSyntax.toNN(this.current, sentence, entities), '}');
        if (this.next)
            code.push('{', ...ThingTalk.NNSyntax.toNN(this.next, sentence, entities), '}');
        else
            code.push('{', '}');

        return code;
    }
};
