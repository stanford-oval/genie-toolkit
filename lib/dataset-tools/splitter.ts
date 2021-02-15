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


import Stream from 'stream';

import { coin } from '../utils/random';
import { requoteSentence, requoteProgram, getFunctions } from './requoting';

import { SentenceFlags, SentenceExample } from './parsers';

function filterForDevices(set : Set<string>, code : string) : boolean {
    for (const token of code.split(' ')) {
        if (token.startsWith('@')) {
            const split = token.substring(1).split('.');
            const kind = split.slice(0, split.length-1).join('.');
            if (!set.has(kind))
                return false;
        }
    }
    return true;
}

function join<T>(iterable : Iterable<T>) : string {
    return Array.from(iterable).join(' ');
}

export const SPLIT_STRATEGIES = {
    id: (id : string) => id,
    'raw-sentence': (id : string, sentence : string) => sentence,
    sentence: (id : string, sentence : string, program : string) => join(requoteSentence(id, sentence, program)),
    spotify: (id : string, sentence : string, program : string) => join(requoteSentence(id, sentence, program)),
    aggregate: (id : string, sentence : string, program : string) => {
        if (program.split(' ').indexOf('aggregate') < 0)
            return ':train';
        return join(requoteSentence(id, sentence, program));
    },
    program: (id : string, sentence : string, program : string) => join(requoteProgram(program)),
    combination: (id : string, sentence : string, program : string) => {
        const functions = Array.from(getFunctions(program));
        if (functions.length <= 1)
            return ':train';
        else
            return functions.join(' ');
    },
    'context-and-program': (id : string, sentence : string, program : string, context ?: string) => context + ' ' + program
};

interface DatasetSplitterOptions {
    locale : string;
    rng : () => number;

    evalProbability : number;
    forDevices ?: string[];
    evalOnSynthetic : boolean;
    useEvalFlag : boolean;
    splitStrategy ?: keyof typeof SPLIT_STRATEGIES;

    train : Stream.Writable;
    eval : Stream.Writable;
    test ?: Stream.Writable;
}

export default class DatasetSplitter extends Stream.Writable {
    private _rng : () => number;
    private _evalProbability : number;
    private _forDevices : Set<string>;
    private _evalOnSynthetic : boolean;
    private _useEvalFlag : boolean;

    private _train : Stream.Writable;
    private _eval : Stream.Writable;
    private _test : Stream.Writable|undefined;

    private _splitStrategy : (id : string, sentence : string, program : string, context ?: string) => string;
    private _dedupedevtestMakeKey : ((splitKey : string, id : string, sentence : string, program : string, context ?: string) => string)|undefined;
    private _devtestset : Set<string>;
    private _dedupeddevtestset : Set<string>;
    private _trainset : Set<string>;

    constructor(options : DatasetSplitterOptions) {
        super({ objectMode: true });

        this._rng = options.rng;
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

    _final(callback : () => void) {
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
    private _isFlaggedForEval(flags : SentenceFlags) {
        if (!this._evalOnSynthetic && (flags.synthetic || flags.augmented))
            return false;

        if (this._useEvalFlag)
            return !!flags.eval;
        else
            return true;
    }

    private async _doWriteLower(stream : Stream.Writable, row : SentenceExample) {
        await new Promise<void>((resolve, reject) => {
            stream.write(row, (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }

    private async _handleOne(row : { id : string, flags : SentenceFlags, preprocessed : string, target_code : string, context ?: string }) {
        if (this._forDevices.size > 0 && !filterForDevices(this._forDevices, row.target_code))
            return;

        const splitKey = this._splitStrategy(row.id, row.preprocessed, row.target_code, row.context);
        const flags = row.flags || {};

        //console.log(flags, splitKey, this._devtestset);

        if (!this._isFlaggedForEval(flags)) {
            if (splitKey !== undefined && this._devtestset.has(splitKey))
                return;
            await this._doWriteLower(this._train, row);
        } else {
            if (splitKey !== undefined && this._devtestset.has(splitKey)) {
                if (this._dedupedevtestMakeKey) {
                    const dedupeKey = this._dedupedevtestMakeKey(splitKey, row.id, row.preprocessed, row.target_code);
                    if (this._dedupeddevtestset.has(dedupeKey))
                        return;
                    this._dedupeddevtestset.add(dedupeKey);
                }
                if (this._test && coin(0.5, this._rng))
                    await this._doWriteLower(this._test, row);
                else
                    await this._doWriteLower(this._eval, row);
            } else if (splitKey !== undefined && this._trainset.has(splitKey)) {
                await this._doWriteLower(this._train, row);
            } else if (coin(this._evalProbability, this._rng)) {
                if (this._dedupedevtestMakeKey) {
                    const dedupeKey = this._dedupedevtestMakeKey(splitKey, row.id, row.preprocessed, row.target_code);
                    if (this._dedupeddevtestset.has(dedupeKey))
                        return;
                    this._dedupeddevtestset.add(dedupeKey);
                }
                if (this._test && coin(0.5, this._rng))
                    await this._doWriteLower(this._test, row);
                else
                    await this._doWriteLower(this._eval, row);
                if (splitKey !== undefined)
                    this._devtestset.add(splitKey);
            } else {
                await this._doWriteLower(this._train, row);
                if (splitKey !== undefined)
                    this._trainset.add(splitKey);
            }
        }
    }

    private async _handleMany(row : SentenceExample) {
        if (typeof row.target_code === 'string') {
            await this._handleOne({
                id: row.id,
                flags: row.flags,
                preprocessed: row.preprocessed,
                target_code: row.target_code,
                context: row.context
            });
            return;
        }

        for (const code of row.target_code) {
            await this._handleOne({
                id: row.id,
                flags: row.flags,
                preprocessed: row.preprocessed,
                target_code: code,
                context: row.context
            });
        }
    }

    _write(row : SentenceExample, encoding : BufferEncoding, callback : (err ?: Error) => void) {
        this._handleMany(row).then(() => callback(), (err) => callback(err));
    }
}
