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

const { DatasetParser, DatasetStringifier } = require('../lib/dataset-tools/parsers');
const StreamUtils = require('../lib/utils/stream-utils');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');
const ParserClient = require('../lib/prediction/parserclient');

class PredictStream extends Stream.Transform {
    constructor(parser, tokenized, debug) {
        super({ objectMode: true });
        
        this._parser = parser;
        this._tokenized = tokenized;
        this._debug = debug;
    }
    
    async _process(ex) {
        const parsed = await this._parser.sendUtterance(ex.preprocessed, ex.context, {}, { tokenized: this._tokenized });

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

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('predict', {
            addHelp: true,
            description: "Compute predictions for Genie-generated dataset."
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument('--url', {
            required: false,
            help: "URL of the server to use. Use a file:// URL pointing to a model directory to predict using a local instance of decanlp",
            defaultValue: 'http://127.0.0.1:8400',
        });
        parser.addArgument('--contextual', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Process a contextual dataset.',
            defaultValue: false
        });
        parser.addArgument('--tokenized', {
            required: false,
            action: 'storeTrue',
            defaultValue: true,
            help: "The dataset is already tokenized (this is the default)."
        });
        parser.addArgument('--no-tokenized', {
            required: false,
            dest: 'tokenized',
            action: 'storeFalse',
            help: "The dataset is not already tokenized."
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input datasets to evaluate (in TSV format); use - for standard input'
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the language to evaluate (defaults to 'en-US', English)`
        });
        parser.addArgument('--debug', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Enable debugging.',
            defaultValue: true
        });
        parser.addArgument('--no-debug', {
            nargs: 0,
            action: 'storeFalse',
            dest: 'debug',
            help: 'Disable debugging.',
        });
        parser.addArgument('--csv', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Output a single CSV line',
        });
    },

    async execute(args) {
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
};
