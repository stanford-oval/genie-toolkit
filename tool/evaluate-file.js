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
import csvparse from 'csv-parse';
import byline from 'byline';
import Stream from 'stream';
import * as Tp from 'thingpedia';

import { AVAILABLE_LANGUAGES } from '../lib/languages';
import { DatasetParser } from '../lib/dataset-tools/parsers';
import { SentenceEvaluatorStream, CollectSentenceStatistics } from '../lib/dataset-tools/evaluation/sentence_evaluator';
import * as StreamUtils from '../lib/utils/stream-utils';

export function initArgparse(subparsers) {
    const parser = subparsers.add_parser('evaluate-file', {
        add_help: true,
        description: "Evaluate a trained model on a Genie-generated dataset, using a pre-generated prediction file."
    });
    parser.add_argument('--thingpedia', {
        required: true,
        help: 'Path to ThingTalk file containing class definitions.'
    });
    parser.add_argument('--dataset', {
        required: true,
        type: fs.createReadStream,
        help: 'Input dataset to evaluate (in TSV format)'
    });
    parser.add_argument('--predictions', {
        required: true,
        type: fs.createReadStream,
        help: 'Prediction results (in TSV format: id, prediction)'
    });
    parser.add_argument('-l', '--locale', {
        required: false,
        default: 'en-US',
        help: `BGP 47 locale tag of the language to evaluate (defaults to 'en-US', English)`
    });
    parser.add_argument('-t', '--target-language', {
        required: false,
        default: 'thingtalk',
        choices: AVAILABLE_LANGUAGES,
        help: `The programming language to generate`
    });
    parser.add_argument('--contextual', {
        action: 'store_true',
        help: 'Process a contextual dataset.',
        default: false
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
    let tpClient = null;
    if (args.thingpedia)
        tpClient = new Tp.FileClient(args);

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
        .pipe(new SentenceEvaluatorStream(null, {
            locale: args.locale,
            targetLanguage: args.target_language,
            thingpediaClient: tpClient,
            tokenized: args.tokenized,
            debug: args.debug,
            complexityMetric: args.complexity_metric
        }))
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
