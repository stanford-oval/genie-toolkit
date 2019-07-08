// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Silei Xu <silei@cs.stanford.edu>
//         Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Stream = require('stream');

const { ParaphraseValidator } = require('../../lib/validator');

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
class ParaphrasingParser extends Stream.Transform {
    constructor(options) {
        super({
            readableObjectMode: true,
            writableObjectMode: true
        });

        this._sentencesPerTask = options.sentencesPerTask;
        this._paraphrasesPerSentence = options.paraphrasesPerSentence;
        this._contextual = options.contextual;

        this._id = 0;
    }

    _transform(row, encoding, callback) {
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
                const id = this._id++;
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

    _flush(callback) {
        process.nextTick(callback);
    }
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
class ParaphrasingAccumulator extends Stream.Transform {
    constructor(targetSize) {
        super({
            readableObjectMode: true,
            writableObjectMode: true
        });

        this._targetSize = targetSize;

        this._synthetics = new Map;
        this._buffers = new Map;
    }

    _transform(row, encoding, callback) {
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

    _flush(callback) {
        for (let [synthetic_id, buffer] of this._buffers) {
            let row = this._synthetics.get(synthetic_id);
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
class ValidationParser extends Stream.Transform {
    constructor(options) {
        super({
            readableObjectMode: true,
            writableObjectMode: true
        });

        this._sentencesPerTask = options.sentencesPerTask;
        this._targetSize = options.targetSize;
        this._skipRejected = options.skipRejected;

        this._id = 0;
    }

    _transform(row, encoding, callback) {
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

    _flush(callback) {
        process.nextTick(callback);
    }
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
class ValidationCounter extends Stream.Transform {
    constructor(options) {
        super({
            readableObjectMode: true,
            writableObjectMode: true
        });

        this._targetNumVotes = options.targetNumVotes;
        this._buffer = new Map;
    }

    _transform(row, encoding, callback) {
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

    _flush(callback) {
        for (let count of this._buffer.values())
            this.push(count);

        this._buffer.clear();
        callback();
    }
}

class ValidationRejecter extends Stream.Transform {
    constructor(options) {
        super({
            readableObjectMode: true,
            writableObjectMode: true
        });

        this._sentencesPerTask = options.sentencesPerTask;
    }

    _transform(row, encoding, callback) {
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

    _flush(callback) {
        process.nextTick(callback);
    }
}

class ParaphrasingRejecter extends Stream.Transform {
    constructor(schemaRetriever, tokenizer, options) {
        super({
            readableObjectMode: true,
            writableObjectMode: true
        });

        this._schemas = schemaRetriever;
        this._tokenizer = tokenizer;

        this._locale = options.locale;
        this._sentencesPerTask = options.sentencesPerTask;
        this._paraphrasesPerSentence = options.paraphrasesPerSentence;
        this._contextual = options.contextual;

        this._counter = {};

        this._id = 0;
    }

    async _validate(paraobj) {
        const paraphrase = new ParaphraseValidator(this._schemas, this._tokenizer, this._locale,
            this._counter, paraobj);

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

    async _doTransform(row) {
        const minibatch = [];

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
                const id = this._id++;

                let paraobj;
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
        }))).filter((paraobj) => paraobj !== null);

        if (validated.length < this._sentencesPerTask * this._paraphrasesPerSentence - 2) {
            row['Approve'] = '';
            row['Reject'] = `Failed to give reasonable result or failed to follow the instruction in at least 2 of ${this._sentencesPerTask * this._paraphrasesPerSentence} paraphrases`;
        } else {
            row['Approve'] = 'x';
            row['Reject'] = '';
        }
        return row;
    }

    _transform(row, encoding, callback) {
        this._doTransform(row).then(
            (row) => callback(null, row),
            (err) => callback(err)
        );
    }

    _flush(callback) {
        process.nextTick(callback);
    }
}

module.exports = {
    ParaphrasingParser,
    ParaphrasingAccumulator,
    ValidationParser,
    ValidationCounter,
    ValidationRejecter,
    ParaphrasingRejecter
};
