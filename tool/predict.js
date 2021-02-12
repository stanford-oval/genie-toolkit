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


import * as fs from 'fs';
import Stream from 'stream';

import { DatasetParser, DatasetStringifier } from '../lib/dataset-tools/parsers';
import * as StreamUtils from '../lib/utils/stream-utils';
import { maybeCreateReadStream, readAllLines } from './lib/argutils';
import * as ParserClient from '../lib/prediction/parserclient';

class PredictStream extends Stream.Transform {
    constructor(parser, tokenized, debug) {
        super({ objectMode: true });
        
        this._parser = parser;
        this._tokenized = tokenized;
        this._debug = debug;
    }
    
    async _process(ex) {
        const parsed = await this._parser.sendUtterance(ex.preprocessed, ex.context, {}, {
            tokenized: this._tokenized,
            skip_typechecking: true
        });

        const predictions = parsed.candidates
            .filter((beam) => beam.score !== 'Infinity') // ignore exact matches
            .map((beam) => beam.code.join(' '));
        if (predictions.length > 0)
            ex.prediction = predictions[0];
        else
            throw new Error(`no prediction produced for ${ex.id}`);
    }
    
    _transform(ex, encoding, callback) {
        this._process(ex).then(() => callback(null, ex), callback);
    }
    
    _flush(callback) {
        process.nextTick(callback);
    }
}

export function initArgparse(subparsers) {
    const parser = subparsers.add_parser('predict', {
        add_help: true,
        description: "Compute predictions for Genie-generated dataset."
    });
    parser.add_argument('-o', '--output', {
        required: true,
        type: fs.createWriteStream
    });
    parser.add_argument('--url', {
        required: false,
        help: "URL of the server to use. Use a file:// URL pointing to a model directory to predict using a local instance of genienlp",
        default: 'http://127.0.0.1:8400',
    });
    parser.add_argument('--contextual', {
        action: 'store_true',
        help: 'Process a contextual dataset.',
        default: false
    });
    parser.add_argument('--tokenized', {
        required: false,
        action: 'store_true',
        default: true,
        help: "The dataset is already tokenized (this is the default)."
    });
    parser.add_argument('--no-tokenized', {
        required: false,
        dest: 'tokenized',
        action: 'store_false',
        help: "The dataset is not already tokenized."
    });
    parser.add_argument('input_file', {
        nargs: '+',
        type: maybeCreateReadStream,
        help: 'Input datasets to evaluate (in TSV format); use - for standard input'
    });
    parser.add_argument('-l', '--locale', {
        required: false,
        default: 'en-US',
        help: `BGP 47 locale tag of the language to evaluate (defaults to 'en-US', English)`
    });
    parser.add_argument('--debug', {
        action: 'store_true',
        help: 'Enable debugging.',
        default: true
    });
    parser.add_argument('--no-debug', {
        action: 'store_false',
        dest: 'debug',
        help: 'Disable debugging.',
    });
    parser.add_argument('--csv', {
        action: 'store_true',
        help: 'Output a single CSV line',
    });
}

export async function execute(args) {
    const parser = ParserClient.get(args.url, args.locale);
    await parser.start();

    readAllLines(args.input_file)
        .pipe(new DatasetParser({ contextual: args.contextual, preserveId: true, parseMultiplePrograms: true }))
        .pipe(new PredictStream(parser, args.tokenized, args.debug))
        .pipe(new DatasetStringifier())
        .pipe(args.output);

    await StreamUtils.waitFinish(args.output);
    await parser.stop();
}
