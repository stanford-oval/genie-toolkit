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

// Parse the raw output of Amazon MTurk into easier to handle objects
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

        this._id = 0;
    }

    _transform(row, encoding, callback) {
        for (let i = 0; i < this._sentencesPerTask; i++) {
            const target_code = row[`Input.thingtalk${i+1}`];
            const synthetic = row[`Input.sentence${i+1}`];
            const synthetic_id = row[`Input.id${i+1}`];

            for (let j = 0; j < this._paraphrasesPerSentence; j++) {
                const paraphrase = row[`Answer.Paraphrase${i+1}-${j+1}`];
                const id = this._id++;
                this.push({
                    id, synthetic_id, synthetic, target_code, paraphrase
                });
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

module.exports = {
    ParaphrasingParser,
    ParaphrasingAccumulator
};
