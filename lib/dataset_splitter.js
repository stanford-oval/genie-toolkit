// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2018-2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Stream = require('stream');

const { coin } = require('./random');
const { requoteSentence, requoteProgram, getFunctions } = require('./requoting');

function filterForDevices(set, code) {
    for (let token of code.split(' ')) {
        if (token.startsWith('@')) {
            let split = token.substring(1).split('.');
            let kind = split.slice(0, split.length-1).join('.');
            if (!set.has(kind))
                return false;
        }
    }
    return true;
}

function join(iterable) {
    return Array.from(iterable).join(' ');
}

const SPLIT_STRATEGIES = {
    id: () => undefined,
    'raw-sentence': (id, sentence) => sentence,
    sentence: (id, sentence, program) => join(requoteSentence(id, sentence, program)),
    spotify: (id, sentence, program) => join(requoteSentence(id, sentence, program)),
    aggregate: (id, sentence, program) => {
        if (program.split(' ').indexOf('aggregate') < 0)
            return ':train';
        return join(requoteSentence(id, sentence, program));
    },
    program: (id, sentence, program) => join(requoteProgram(program)),
    combination: (id, sentence, program) => {
        const functions = Array.from(getFunctions(program));
        if (functions.length <= 1)
            return ':train';
        else
            return functions.join(' ');
    },
    'context-and-program': (id, sentence, program, context) => context + ' ' + program
};

module.exports = class DatasetSplitter extends Stream.Writable {
    constructor(options) {
        super({ objectMode: true });

        this._rng = options.rng;
        this._locale = options.locale;
        this._evalOnSynthetic = options.evalOnSynthetic;
        this._useEvalFlag = options.useEvalFlag;

        this._train = options.train;
        this._eval = options.eval;
        this._test = options.test;

        this._evalProbability = options.evalProbability;
        this._forDevices = new Set(options.forDevices || []);

        this._splitStrategy = SPLIT_STRATEGIES[options.splitStrategy || 'sentence'];

        this._dedupedevtestMakeKey = undefined;
        if (options.splitStrategy === 'sentence' || options.splitStrategy === 'raw-sentence')
            this._dedupedevtestMakeKey = (splitKey) => splitKey;
        else if (options.splitStrategy === 'program' || options.splitStrategy === 'combination')
            this._dedupedevtestMakeKey = (splitKey, id, sentence, program) => SPLIT_STRATEGIES.sentence(id, sentence, program);

        this._devtestset = new Set;
        this._dedupeddevtestset = new Set;
        this._trainset = new Set;
        this._trainset.add(':train');
    }

    _final(callback) {
        this._train.end();
        this._eval.end();
        if (this._test)
            this._test.end();
        callback();
    }

    /**
      Check if this example can potentially be used for evaluation.

      If this method returns true, the example is a candidate for sampling
      in the evaluation sets (validation/test).

      Synthetic (S) and augmented (P) sentences are excluded if `evalOnSynthetic`
      is false (default),

      If `useEvalFlag` was passed as option, this method considers the `eval` flag
      (E flag in TSV format), otherwise all other sentences are potentially included
      in the evaluation sets.
     */
    _isFlaggedForEval(flags) {
        if (!this._evalOnSynthetic && (flags.synthetic || flags.augmented))
            return false;

        if (this._useEvalFlag)
            return !!flags.eval;
        else
            return true;
    }

    _write(row, encoding, callback) {
        if (this._forDevices.size > 0 && !filterForDevices(this._forDevices, row.target_code)) {
            callback();
            return;
        }

        const splitKey = this._splitStrategy(row.id, row.preprocessed, row.target_code, row.context);
        const flags = row.flags || {};

        //console.log(flags, splitKey, this._devtestset);

        if (!this._isFlaggedForEval(flags)) {
            if (splitKey !== undefined && this._devtestset.has(splitKey)) {
                callback();
                return;
            }
            this._train.write(row, callback);
        } else {
            if (splitKey !== undefined && this._devtestset.has(splitKey)) {
                if (this._dedupedevtestMakeKey) {
                    const dedupeKey = this._dedupedevtestMakeKey(splitKey, row.id, row.preprocessed, row.target_code);
                    if (this._dedupeddevtestset.has(dedupeKey)) {
                        callback();
                        return;
                    }
                    this._dedupeddevtestset.add(dedupeKey);
                }
                if (this._test && coin(0.5, this._rng))
                    this._test.write(row, callback);
                else
                    this._eval.write(row, callback);
            } else if (splitKey !== undefined && this._trainset.has(splitKey)) {
                this._train.write(row, callback);
            } else if (coin(this._evalProbability, this._rng)) {
                if (this._dedupedevtestMakeKey) {
                    const dedupeKey = this._dedupedevtestMakeKey(splitKey, row.id, row.preprocessed, row.target_code);
                    if (this._dedupeddevtestset.has(dedupeKey)) {
                        callback();
                        return;
                    }
                    this._dedupeddevtestset.add(dedupeKey);
                }
                if (this._test && coin(0.5, this._rng))
                    this._test.write(row, callback);
                else
                    this._eval.write(row, callback);
                if (splitKey !== undefined)
                    this._devtestset.add(splitKey);
            } else {
                this._train.write(row, callback);
                if (splitKey !== undefined)
                    this._trainset.add(splitKey);
            }
        }
    }
};
module.exports.SPLIT_STRATEGIES = Object.keys(SPLIT_STRATEGIES);
