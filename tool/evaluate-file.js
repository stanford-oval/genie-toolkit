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
const csvparse = require('csv-parse');
const byline = require('byline');
const Stream = require('stream');
const Tp = require('thingpedia');
const ThingTalk = require('thingtalk');

const { DatasetParser } = require('../lib/dataset-tools/parsers');
const { SentenceEvaluatorStream, CollectSentenceStatistics } = require('../lib/dataset-tools/evaluation/sentence_evaluator');
const StreamUtils = require('../lib/utils/stream-utils');

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('evaluate-file', {
            addHelp: true,
            description: "Evaluate a trained model on a Genie-generated dataset, using a pre-generated prediction file."
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.addArgument('--dataset', {
            required: true,
            type: fs.createReadStream,
            help: 'Input dataset to evaluate (in TSV format)'
        });
        parser.addArgument('--predictions', {
            required: true,
            type: fs.createReadStream,
            help: 'Prediction results (in TSV format: id, prediction)'
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the language to evaluate (defaults to 'en-US', English)`
        });
        parser.addArgument('--contextual', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Process a contextual dataset.',
            defaultValue: false
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
        const tpClient = new Tp.FileClient(args);
        const schemas = new ThingTalk.SchemaRetriever(tpClient, null, true);

        const columns = args.contextual ?
            ['id', 'context', 'sentence', 'target_code', 'prediction'] :
            ['id', 'sentence', 'target_code', 'prediction'];
        const predictionstream = args.predictions
            .pipe(csvparse({ columns, delimiter: '\t', relax: true }))
            .pipe(new StreamUtils.MapAccumulator());
        const predictions = await predictionstream.read();

        const output = args.dataset
            .setEncoding('utf8')
            .pipe(byline())
            .pipe(new DatasetParser({ contextual: args.contextual, preserveId: true, parseMultiplePrograms: true }))
            .pipe(new Stream.Transform({
                objectMode: true,

                transform(ex, encoding, callback) {
                    const prediction = predictions.get(ex.id);
                    if (!prediction)
                        throw new Error(`missing prediction for sentence ${ex.id}`);

                    ex.predictions = [prediction.prediction.split(' ')];
                    callback(null, ex);
                },

                flush(callback) {
                    process.nextTick(callback);
                }
            }))
            .pipe(new SentenceEvaluatorStream(null, schemas, true, args.debug))
            .pipe(new CollectSentenceStatistics());

        const result = await output.read();
        if (args.csv) {
            let buffer = String(result.total);
            for (let key of ['ok', 'ok_without_param', 'ok_function', 'ok_device', 'ok_num_function', 'ok_syntax']) {
                result[key].length = parseInt(process.env.CSV_LENGTH || 1);
                if (buffer)
                    buffer += ',';
                buffer += String(result[key]);
            }
            console.log(buffer);
        } else {
            for (let key in result) {
                if (Array.isArray(result[key]))
                    console.log(`${key} = [${result[key].join(', ')}]`);
                else
                    console.log(`${key} = ${result[key]}`);
            }
	}
    }
};
