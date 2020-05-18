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

const Utils = require('./utils');
const { stripOutTypeAnnotations, normalizeKeywordParams } = require('./eval_utils');

class DialogueEvaluatorStream extends Stream.Transform {
    constructor(parser, tokenizer, options) {
        super({ objectMode: true });

        this._parser = parser;
        this._tokenizer = tokenizer;
        this._target = require('../lib/languages/' + options.targetLanguage);

        this._options = options;
        this._locale = options.locale;
        this._debug = options.debug;
        this._tokenized = options.tokenized;
    }

    async _preprocess(sentence, contextEntities) {
        let tokenized;
        if (this._tokenized) {
            const tokens = sentence.split(' ');
            const entities = Utils.makeDummyEntities(sentence);
            tokenized = { tokens, entities };
        } else {
            tokenized = await this._tokenizer.tokenize(this._locale, sentence);
        }
        Utils.renumberEntities(tokenized, contextEntities);
        return tokenized;
    }

    async _checkTurn(id, turn, turnIndex) {
        let context, contextCode, contextEntities;
        if (turnIndex > 0) {
            context = await this._target.parse(turn.context, this._options);
            // apply the agent prediction to the context to get the state of the dialogue before
            // the user speaks
            const agentPrediction = await this._target.parse(turn.agent_target, this._options);
            context = this._target.computeNewState(context, agentPrediction);

            const userContext = this._target.prepareContextForPrediction(context, 'user');
            [contextCode, contextEntities] = this._target.serializeNormalized(userContext);
        } else {
            context = null;
            contextCode = ['null'];
            contextEntities = {};
        }

        const { tokens, entities } = await this._preprocess(turn.user, contextEntities);
        const userTarget = await this._target.parse(turn.user_target, this._options);
        const targetCode = (await this._target.serializePrediction(userTarget, tokens, entities, 'user')).join(' ');

        const parsed = await this._parser.sendUtterance(tokens.join(' '), true, contextCode, contextEntities);

        const predictions = parsed.candidates
            .filter((beam) => beam.score !== 'Infinity') // ignore exact matches
            .map((beam) => beam.code);

        if (predictions.length === 0)
            return false;

        const choice = predictions[0];

        // first check if the program parses and typechecks (no hope otherwise)
        let program;
        try {
            program = await this._target.parsePrediction(choice, entities, this._options);
        } catch(e) {
            if (this._debug)
                console.log(`${id}:${turnIndex}\twrong_syntax\t${contextCode.join(' ')}\t${turn.user}\t${choice.join(' ')}`);
        }
        if (program === null) {
            if (this._debug)
                console.log(`${id}:${turnIndex}\twrong_syntax\t${contextCode.join(' ')}\t${turn.user}\t${choice.join(' ')}`);
            return false;
        }

        const normalized = normalizeKeywordParams(Array.from(stripOutTypeAnnotations(choice))).join(' ');

        if (normalized === targetCode) {
            if (this._debug)
                console.log(`${id}:${turnIndex}\tok\t${contextCode.join(' ')}\t${turn.user}\t${normalized}\t${targetCode}`);
            return true;
        } else {
            if (this._debug)
                console.log(`${id}:${turnIndex}\tok_syntax\t${contextCode.join(' ')}\t${turn.user}\t${normalized}\t${targetCode}`);
            return false;
        }
    }

    async _evaluate(dialog) {
        let prefix = 0;
        let correct = 0;
        let failed = false;
        for (let i = 0; i < dialog.length; i++) {
            const turn = dialog[i];
            const ok = await this._checkTurn(dialog.id, turn, i);
            if (ok) {
                correct += 1;
                if (!failed)
                    prefix += 1;
            } else {
                failed = true;
            }
        }

        const ret = {
            turns: dialog.length,
            ok: prefix === dialog.length,
            ok_initial: prefix >= 1,
            ok_partial: correct,
            ok_prefix: prefix,
            ok_progress: prefix,
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
            ok_prefix: 0,
            ok_progress: 0,
        };
    }

    _write(sample, encoding, callback) {
        this._buffer.total ++;
        this._buffer.turns += sample.turns;
        for (let key of ['ok', 'ok_initial', 'ok_partial', 'ok_prefix', 'ok_progress'])
            this._buffer[key] += sample[key];
        callback();
    }

    _final(callback) {
        // convert to percentages
        for (let key of ['ok', 'ok_initial', 'ok_progress'])
            this._buffer[key] /= this._buffer.total;
        for (let key of ['ok_partial', 'ok_prefix'])
            this._buffer[key] /= this._buffer.turns;
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
