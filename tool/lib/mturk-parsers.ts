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
// Author: Silei Xu <silei@cs.stanford.edu>
//         Giovanni Campagna <gcampagn@cs.stanford.edu>

import { SchemaRetriever } from 'thingtalk';
import * as Stream from 'stream';

import * as I18n from '../../lib/i18n';
import { ParaphraseValidator, Statistics } from '../../lib/dataset-tools/mturk/validator';

export interface ParsedParaphrase {
    id : string;
    synthetic_id : string;
    synthetic : string;
    context ?: string;
    context_utterance ?: string;
    assistant_action ?: string;
    target_code : string;
    paraphrase : string;
}

interface ParaphrasingParserOptions {
    sentencesPerTask : number;
    paraphrasesPerSentence : number;
    contextual : boolean;
    skipRejected : boolean;
}

// Parse the raw output of Amazon MTurk paraphrasing into easier to handle objects
//
// Input:
//  - one row per task submission
//    formatted as per MTurk results
//
// Output:
//  - one row per paraphrase, each with:
//    - id
//    - synthetic_id
//    - synthetic
//    - target_code
//    - paraphrase
export class ParaphrasingParser extends Stream.Transform {
    private _sentencesPerTask : number;
    private _paraphrasesPerSentence : number;
    private _contextual : boolean;

    private _id : number;

    constructor(options : ParaphrasingParserOptions) {
        super({
            readableObjectMode: true,
            writableObjectMode: true
        });

        this._sentencesPerTask = options.sentencesPerTask;
        this._paraphrasesPerSentence = options.paraphrasesPerSentence;
        this._contextual = options.contextual;

        this._id = 0;
    }

    _transform(row : Record<string, string>, encoding : BufferEncoding, callback : () => void) {
        for (let i = 0; i < this._sentencesPerTask; i++) {
            const target_code = row[`Input.thingtalk${i+1}`];
            const synthetic = row[`Input.sentence${i+1}`];
            const synthetic_id = row[`Input.id${i+1}`];

            let context, context_utterance, assistant_action;
            if (this._contextual) {
                context = row[`Input.context${i+1}`];
                context_utterance = row[`Input.context_utterance${i+1}`];
                assistant_action = row[`Input.assistant_action${i+1}`];
            }

            for (let j = 0; j < this._paraphrasesPerSentence; j++) {
                const paraphrase = row[`Answer.Paraphrase${i+1}-${j+1}`];
                const id = (this._contextual ? 'C' : '') + this._id++;
                if (this._contextual) {
                    this.push({
                        id, synthetic_id, synthetic,
                        context, context_utterance, assistant_action,
                        target_code, paraphrase
                    });
                } else {
                    this.push({
                        id, synthetic_id, synthetic, target_code, paraphrase
                    });
                }
            }
        }
        callback();
    }

    _flush(callback : () => void) {
        process.nextTick(callback);
    }
}

export interface AccumulatedParaphrases {
    synthetic_id : string;
    synthetic : string;
    target_code : string;
    paraphrases : Array<{ id : string; paraphrase : string }>;
}

// Accumulate all paraphrases of the same synthetic
//
// Input:
//  - one row per paraphrase, each with:
//    - id
//    - synthetic_id
//    - synthetic
//    - target_code
//    - paraphrase
//
// Output:
//  - one row per synthetic, each with:
//    - synthetic_id
//    - synthetic
//    - target_code
//    - paraphrases: array of { id, paraphrase }
export class ParaphrasingAccumulator extends Stream.Transform {
    private _totalParaphrasesPerSentence : number;
    private _synthetics : Map<string, ParsedParaphrase>;
    private _buffers : Map<string, Array<{ id : string; paraphrase : string }>>;

    constructor(totalParaphrasesPerSentence : number) {
        super({
            readableObjectMode: true,
            writableObjectMode: true
        });

        this._totalParaphrasesPerSentence = totalParaphrasesPerSentence;

        this._synthetics = new Map;
        this._buffers = new Map;
    }

    _transform(row : ParsedParaphrase, encoding : BufferEncoding, callback : () => void) {
        const synthetic_id = row.synthetic_id;

        let buffer = this._buffers.get(synthetic_id);
        if (!buffer) {
            this._synthetics.set(synthetic_id, row);
            this._buffers.set(synthetic_id, buffer = []);
        }

        buffer.push({
            id: row.id,
            paraphrase: row.paraphrase
        });

        if (buffer.length >= this._totalParaphrasesPerSentence) {
            this.push({
                synthetic_id,
                synthetic: row.synthetic,
                target_code: row.target_code,
                paraphrases: buffer
            });
            this._buffers.delete(synthetic_id);
        }
        callback();
    }

    _flush(callback : () => void) {
        for (const [synthetic_id, buffer] of this._buffers) {
            const row = this._synthetics.get(synthetic_id)!;
            this.push({
                synthetic_id,
                synthetic: row.synthetic,
                target_code: row.target_code,
                paraphrases: buffer
            });
        }

        this._buffers.clear();
        this._synthetics.clear();
        callback();
    }
}

interface ValidationParserOptions {
    sentencesPerTask : number;
    targetSize : number;
    skipRejected : boolean;
}

// Parse the raw output of Amazon MTurk validation into easier to handle objects
//
// Input:
//  - one row per task submission
//    formatted as per MTurk results
//
// Output:
//  - one row per paraphrase, each with:
//    - id
//    - synthetic_id
//    - synthetic
//    - target_code
//    - paraphrase
//    - vote
export class ValidationParser extends Stream.Transform {
    private _sentencesPerTask : number;
    private _targetSize : number;
    private _skipRejected : boolean;

    constructor(options : ValidationParserOptions) {
        super({
            readableObjectMode: true,
            writableObjectMode: true
        });

        this._sentencesPerTask = options.sentencesPerTask;
        this._targetSize = options.targetSize;
        this._skipRejected = options.skipRejected;
    }

    _transform(row : Record<string, string>, encoding : BufferEncoding, callback : () => void) {
        if (this._skipRejected && row['Reject']) {
            callback();
            return;
        }

        for (let i = 0; i < this._sentencesPerTask; i++) {
            const target_code = row[`Input.thingtalk${i+1}`];
            const synthetic = row[`Input.sentence${i+1}`];
            const synthetic_id = row[`Input.id${i+1}`];

            // + 2 to account for same/different paraphrases (sanity checks)
            // mixed in with the real data
            for (let j = 0; j < this._targetSize + 2; j++) {
                const paraphrase = row[`Input.paraphrase${i+1}-${j+1}`];
                const id = row[`Input.id${i+1}-${j+1}`];
                if (id === '-same' || id === '-different')
                    continue;

                const vote = row[`Answer.${i+1}-${j+1}`];
                this.push({
                    id, synthetic_id, synthetic, target_code, paraphrase, vote
                });
            }
        }
        callback();
    }

    _flush(callback : () => void) {
        process.nextTick(callback);
    }
}

interface ValidationCounterOptions {
    targetNumVotes : number;
}

export interface ValidationCount {
    id : string;
    synthetic_id : string;
    synthetic : string;
    target_code : string;
    paraphrase : string;
    same_count : number;
    diff_count : number;
}

// Count all validation votes of the same paraphrase
//
// Input:
//  - one row per validation task, each with:
//    - id
//    - synthetic_id
//    - synthetic
//    - target_code
//    - paraphrase
//    - vote
//
// Output:
//  - one row per paraphrase, each with:
//    - id
//    - synthetic_id
//    - synthetic
//    - target_code
//    - paraphrase
//    - same_count
//    - diff_count
export class ValidationCounter extends Stream.Transform {
    private _targetNumVotes : number;
    private _buffer : Map<string, ValidationCount>;

    constructor(options : ValidationCounterOptions) {
        super({
            readableObjectMode: true,
            writableObjectMode: true
        });

        this._targetNumVotes = options.targetNumVotes;
        this._buffer = new Map;
    }

    _transform(row : ParsedParaphrase & { vote : string }, encoding : BufferEncoding, callback : () => void) {
        const id = row.id;

        let count = this._buffer.get(id);
        if (!count) {
            this._buffer.set(id, count = {
                id,
                synthetic_id: row.synthetic_id,
                synthetic: row.synthetic,
                target_code: row.target_code,
                paraphrase: row.paraphrase,
                same_count: 0,
                diff_count: 0
            });
        }

        if (row.vote === 'same')
            count.same_count ++;
        else
            count.diff_count ++;

        if (count.same_count + count.diff_count >= this._targetNumVotes) {
            this.push(count);
            this._buffer.delete(id);
        }
        callback();
    }

    _flush(callback : () => void) {
        for (const count of this._buffer.values())
            this.push(count);

        this._buffer.clear();
        callback();
    }
}

interface ValidationRejecterOptions {
    sentencesPerTask : number;
}

export class ValidationRejecter extends Stream.Transform {
    private _sentencesPerTask : number;

    constructor(options : ValidationRejecterOptions) {
        super({
            readableObjectMode: true,
            writableObjectMode: true
        });

        this._sentencesPerTask = options.sentencesPerTask;
    }

    _transform(row : Record<string, string>, encoding : BufferEncoding, callback : (err : Error|null, row : Record<string, string>) => void) {
        let incorrect = 0;
        for (let i = 0; i < this._sentencesPerTask; i++) {
            const indexSame = row[`Input.index_same${i+1}`];
            const indexDifferent = row[`Input.index_diff${i+1}`];
            const answerSame = row[`Answer.${i+1}-${indexSame}`];
            const answerDifferent = row[`Answer.${i+1}-${indexDifferent}`];
            if (answerSame !== 'same')
                incorrect++;
            if (answerDifferent !== 'different')
                incorrect++;
        }

        if (incorrect >= 2) {
            row['Approve'] = '';
            row['Reject'] = '2 or more mistakes in the sanity checks hidden among the questions.';
        } else {
            row['Approve'] = 'x';
            row['Reject'] = '';
        }

        callback(null, row);
    }

    _flush(callback : () => void) {
        process.nextTick(callback);
    }
}

interface ParaphrasingRejecterOptions {
    locale : string;
    timezone : string;
    sentencesPerTask : number;
    paraphrasesPerSentence : number;
    contextual : boolean;
}

export class ParaphrasingRejecter extends Stream.Transform {
    private _schemas : SchemaRetriever;
    private _langPack : I18n.LanguagePack;
    private _tokenizer : I18n.BaseTokenizer;

    private _locale : string;
    private _timezone : string;
    private _sentencesPerTask : number;
    private _paraphrasesPerSentence : number;
    private _contextual : boolean;

    private _counter : Statistics;
    private _id : number;

    constructor(schemaRetriever : SchemaRetriever,
                options : ParaphrasingRejecterOptions) {
        super({
            readableObjectMode: true,
            writableObjectMode: true
        });

        this._schemas = schemaRetriever;
        this._langPack = I18n.get(options.locale);
        this._tokenizer = this._langPack.getTokenizer();

        this._locale = options.locale;
        this._timezone = options.timezone;
        this._sentencesPerTask = options.sentencesPerTask;
        this._paraphrasesPerSentence = options.paraphrasesPerSentence;
        this._contextual = options.contextual;

        this._counter = {
            'good': 0,
            'no_idea': 0,
            'values': 0,
            'quoting': 0,
            'manual': 0
        };

        this._id = 0;
    }

    private async _validate(paraobj : ParsedParaphrase) {
        const paraphrase = new ParaphraseValidator(this._schemas, this._langPack, this._tokenizer, this._locale,
            this._timezone, paraobj, this._counter, false);

        try {
            await paraphrase.clean();
            if (paraphrase.isValid())
                return paraobj;
            else
                return null;
        } catch(e) {
            console.error(`Failed paraphrase ${paraobj.id} (${paraobj.synthetic_id}): ${e.message}`);
            return null;
        }
    }

    async _doTransform(row : Record<string, string>) : Promise<Record<string, string>> {
        const minibatch : ParsedParaphrase[] = [];

        for (let i = 0; i < this._sentencesPerTask; i++) {
            const target_code = row[`Input.thingtalk${i+1}`];
            const synthetic = row[`Input.sentence${i+1}`];
            const synthetic_id = row[`Input.id${i+1}`];

            let context, context_utterance, assistant_action;
            if (this._contextual) {
                context = row[`Input.context${i+1}`];
                context_utterance = row[`Input.context_utterance${i+1}`];
                assistant_action = row[`Input.assistant_action${i+1}`];
            }

            for (let j = 0; j < this._paraphrasesPerSentence; j++) {
                const paraphrase = row[`Answer.Paraphrase${i+1}-${j+1}`];
                const id = (this._contextual ? 'C' : '') + this._id++;

                let paraobj : ParsedParaphrase;
                if (this._contextual) {
                    paraobj = {
                        id, synthetic_id, synthetic,
                        context, context_utterance, assistant_action,
                        target_code, paraphrase
                    };
                } else {
                    paraobj = {
                        id, synthetic_id, synthetic, target_code, paraphrase
                    };
                }
                minibatch.push(paraobj);
            }
        }

        const validated = (await Promise.all(minibatch.map((paraobj) => {
            return this._validate(paraobj);
        }))).filter(<T>(c : T) : c is Exclude<T, null> => c !== null);

        if (validated.length < this._sentencesPerTask * this._paraphrasesPerSentence - 2) {
            row['Approve'] = '';
            row['Reject'] = `Failed to give reasonable result or failed to follow the instruction in at least 2 of ${this._sentencesPerTask * this._paraphrasesPerSentence} paraphrases`;
        } else {
            row['Approve'] = 'x';
            row['Reject'] = '';
        }
        return row;
    }

    _transform(row : Record<string, string>, encoding : BufferEncoding, callback : (err : Error|null, row ?: Record<string, string>) => void) {
        this._doTransform(row).then(
            (row) => callback(null, row),
            (err) => callback(err)
        );
    }

    _flush(callback : () => void) {
        process.nextTick(callback);
    }
}
