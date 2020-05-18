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

const Stream = require('stream');
const ThingTalk = require('thingtalk');

const Utils = require('./utils');
const { stripOutTypeAnnotations, normalizeKeywordParams } = require('./eval_utils');

class DialogueEvaluatorStream extends Stream.Transform {
    constructor(parser, schemas, tokenized, debug) {
        super({ objectMode: true });

        this._parser = parser;
        this._schemas = schemas;
        this._tokenized = tokenized;
        this._debug = debug;
    }

    async _checkTurn(id, turn, contextCode, contextEntities, input, targetProgram) {
        // if we're expecting a string answer, we're in raw mode so the answer will always be correct
        if (targetProgram.isBookkeeping && targetProgram.intent.isAnswer && targetProgram.intent.value.isString)
            return true;

        let tokens;
        let entities;
        if (this._tokenized) {
            tokens = input.split(' ');
            entities = Utils.makeDummyEntities(input);
            Object.assign(entities, contextEntities);
        } else {
            const tokenized = await this._parser.tokenize(input, contextEntities);
            tokens = tokenized.tokens;
            entities = tokenized.entities;
        }

        const targetCode = ThingTalk.NNSyntax.toNN(targetProgram, tokens, entities);
        const untypedTargetCode = Array.from(stripOutTypeAnnotations(targetCode)).join(' ');

        const parsed = await this._parser.sendUtterance(tokens.join(' '), true, contextCode, contextEntities);

        const predictions = parsed.candidates
            .filter((beam) => beam.score !== 'Infinity') // ignore exact matches
            .map((beam) => beam.code);

        if (predictions.length === 0)
            return false;

        const choice = predictions[0];

        // first check if the program parses and typechecks (no hope otherwise)
        try {
            const parsed = ThingTalk.NNSyntax.fromNN(choice, entities);
            await parsed.typecheck(this._schemas);
        } catch(e) {
            if (this._debug)
                console.log(`${id}:${turn}\twrong_syntax\t${contextCode.join(' ')}\t${input}\t${choice.join(' ')}`);
            return false;
        }

        const normalized = normalizeKeywordParams(Array.from(stripOutTypeAnnotations(choice))).join(' ');

        if (normalized === untypedTargetCode) {
            if (this._debug)
                console.log(`${id}:${turn}\tok\t${contextCode.join(' ')}\t${input}\t${normalized}\t${untypedTargetCode}`);
            return true;
        } else {
            if (this._debug)
                console.log(`${id}:${turn}\tok_syntax\t${contextCode.join(' ')}\t${input}\t${normalized}\t${untypedTargetCode}`);
            return false;
        }
    }

    _applyReplyToContext(context, newCommand) {
        if (newCommand.isProgram || newCommand.isPermissionRule) {
            return newCommand;
        } else if (newCommand.isBookkeeping && newCommand.intent.isAnswer) {
            for (let [, slot] of context.iterateSlots()) {
                if (slot instanceof ThingTalk.Ast.Selector)
                    continue;
                if (!slot.value.isUndefined)
                    continue;
                slot.value = newCommand.intent.value;
                return context;
            }
            throw new Error('???');
        } else if (newCommand.isBookkeeping && newCommand.intent.isSpecial) {
            if (newCommand.intent.type === 'nevermind' || newCommand.intent.type === 'stop')
                return null;
            else // yes/no
                return context;
        } else {
            throw new Error('????');
        }
    }

    async _evaluate(dialog) {
        let context = null;
        let contextNN = ['null'];
        let contextEntities = {};

        let progress = 0;
        let correct = 0;
        let failed = false;
        for (let i = 0; i < dialog.length; i += 2) {
            const input = dialog[i];
            const targetCode = dialog[i+1];

            const targetCommand = ThingTalk.Grammar.parse(targetCode);
            await targetCommand.typecheck(this._schemas);

            const ok = await this._checkTurn(dialog.id, i/2, contextNN, contextEntities, input, targetCommand);
            if (ok) {
                correct += 2;
                if (!failed)
                    progress += 2;
            } else {
                failed = true;
            }

            context = this._applyReplyToContext(context, targetCommand);

            contextEntities = {};
            if (context !== null)
                contextNN = ThingTalk.NNSyntax.toNN(context, '', contextEntities, { allocateEntities: true });
            else
                contextNN = ['null'];
        }

        const ret = {
            turns: dialog.length/2,
            ok: progress === dialog.length,
            ok_initial: progress >= 2,
            ok_partial: correct/dialog.length,
            ok_progress: progress/dialog.length
        };
        if (this._debug)
            console.log(`${dialog.id}\t${ret.ok}\t${ret.ok_initial}\t${ret.ok_partial}\t${ret.ok_progress}`);

        return ret;
    }

    _transform(dialog, encoding, callback) {
        this._evaluate(dialog).then((result) => callback(null, result), (err) => callback(err));
    }

    _flush(callback) {
        process.nextTick(callback);
    }
}

class CollectDialogueStatistics extends Stream.Writable {
    constructor() {
        super({ objectMode: true });

        this._buffer = {
            total: 0,
            turns: 0,
            ok: 0,
            ok_initial: 0,
            ok_partial: 0,
            ok_progress: 0,
        };
    }

    _write(sample, encoding, callback) {
        this._buffer.total ++;
        this._buffer.turns += sample.turns;
        for (let key of ['ok', 'ok_initial', 'ok_partial', 'ok_progress'])
            this._buffer[key] += sample[key];
        callback();
    }

    _final(callback) {
        // convert to percentages
        for (let key of ['ok', 'ok_initial', 'ok_partial', 'ok_progress'])
            this._buffer[key] /= this._buffer.total;
        callback();
    }

    read() {
        return new Promise((resolve, reject) => {
            this.on('finish', () => resolve(this._buffer));
            this.on('error', reject);
        });
    }
}

module.exports = {
    DialogueEvaluatorStream,
    CollectDialogueStatistics
};
