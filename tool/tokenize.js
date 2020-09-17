// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
"use strict";

const fs = require('fs');
const Stream = require('stream');
const { readAllLines } = require('./lib/argutils');

const { DatasetParser, DatasetStringifier } = require('../lib/dataset-tools/parsers');
const I18n = require('../lib/i18n');

const { maybeCreateReadStream, } = require('./lib/argutils');

class TokenizerStream extends Stream.Transform {
    constructor(options) {
        super({ objectMode: true });

        this._tokenizer = I18n.get(options.locale).getTokenizer();
    }

    _transform(row, encoding, callback) {
        if (Object.keys(row).length < 1 || !row.preprocessed) {
            callback();
            return;
        }

        if (row.preprocessed.includes('DURATION_0')) {
            callback();
            return;
        }

        const utterance = row.preprocessed
            .replace('PHONE_NUMBER_0', '+16501234567')
            .replace('NUMBER_0', '42')
            .replace('NUMBER_1', '43')
            .replace('NUMBER_2', '44')
            .replace('EMAIL_ADDRESS_0', 'almond@stanford.edu')
            .replace('DATE_0', 'august 4')
            .replace('DATE_1', 'september 5')
            .replace('TIME_0', '9:00 AM')
            .replace('TIME_1', '10:00 PM');
        const preprocessed = this._tokenizer.tokenize(utterance).tokens.join(' ');
        callback(null, { id: row.id, preprocessed, target_code: row.target_code});
    }

    _flush(callback) {
        process.nextTick(callback);
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.add_parser('tokenize', {
            add_help: true,
            description: "Preprocess (tokenize) a string value dataset."
        });
        parser.add_argument('-l', '--locale', {
            required: false,
            default: 'en-US',
            help: `BGP 47 locale tag of the language to use for tokenization (defaults to 'en-US', English)`
        });
        parser.add_argument('-o', '--output', {
            required: true,
            type: fs.createWriteStream
        });
        parser.add_argument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input string datasets to tokenize (in TSV format); use - for standard input'
        });
    },

    async execute(args) {
        await readAllLines(args.input_file)
            .pipe(new DatasetParser({ preserveId: true, parseMultiplePrograms: true}))
            .pipe(new TokenizerStream(args))
            .pipe(new DatasetStringifier())
            .pipe(args.output);
    },
};
