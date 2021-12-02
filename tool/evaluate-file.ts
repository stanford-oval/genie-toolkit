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
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>

import * as argparse from 'argparse';
import * as fs from 'fs';
import * as Tp from 'thingpedia';
import csvparse from 'csv-parse';
import Stream from 'stream';

import { DatasetParser } from '../lib/dataset-tools/parsers';
import { SentenceEvaluatorStream, CollectSentenceStatistics } from '../lib/dataset-tools/evaluation/sentence_evaluator';
import * as StreamUtils from '../lib/utils/stream-utils';

import { maybeCreateReadStream, readAllLines } from './lib/argutils';
import { outputResult } from './lib/evaluate-common';

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('evaluate-file', {
        add_help: true,
        description: "Evaluate a trained model on a Genie-generated dataset, using a pre-generated prediction file."
    });
    parser.add_argument('--thingpedia', {
        required: true,
        help: 'Path to ThingTalk file containing class definitions.'
    });
    parser.add_argument('--parameter-datasets', {
        required: true,
        help: 'Path to parameter dataset manifest.'
    });
    parser.add_argument('--predictions', {
        required: true,
        type: fs.createReadStream,
        help: 'Prediction results (in TSV format: id, sentence, target, prediction)'
    });
    parser.add_argument('input_file', {
        nargs: '+',
        type: maybeCreateReadStream,
        help: 'Input datasets to evaluate (in TSV format); use - for standard input'
    });
    parser.add_argument('-o', '--output', {
        required: false,
        type: fs.createWriteStream,
        default: process.stdout
    });
    parser.add_argument('-l', '--locale', {
        required: false,
        default: 'en-US',
        help: `BGP 47 locale tag of the language to evaluate (defaults to 'en-US', English)`
    });
    parser.add_argument('--timezone', {
        required: false,
        default: undefined,
        help: `Timezone to use to interpret dates and times (defaults to the current timezone).`
    });
    parser.add_argument('-t', '--target-language', {
        required: false,
        default: 'thingtalk',
        choices: ['thingtalk', 'dlgthingtalk'],
        help: `The programming language to generate`
    });
    parser.add_argument('--tokenized', {
        action: 'store_true',
        help: 'The utterances are tokenized.',
        default: true
    });
    parser.add_argument('--no-tokenized', {
        action: 'store_false',
        dest: 'tokenized',
        help: 'The utterances are not tokenized.',
    });
    parser.add_argument('--contextual', {
        action: 'store_true',
        help: 'Process a contextual dataset.',
        default: false
    });
    parser.add_argument('--split-by-device', {
        action: 'store_true',
        help: 'Compute evaluation statistics separating examples by Thingpedia device',
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
        default: false
    });
    parser.add_argument('--csv-prefix', {
        required: false,
        default: '',
        help: `Prefix all output lines with this string`
    });
    parser.add_argument('--complexity-metric', {
        choices: ['num_params', 'turn_number'],
        default: 'num_params',
        help: `Complexity metric to use to divide examples by complexity`
    });
    parser.add_argument('--max-complexity', {
        required: false,
        type: Number,
        default: '',
        help: 'Collapse all examples of complexity greater or equal to this',
    });
    parser.add_argument('--min-complexity', {
        required: false,
        type: Number,
        default: 0,
        help: 'Collapse all examples of complexity smaller or equal to this',
    });
    parser.add_argument('--oracle', {
        action: 'store_true',
        help: 'Indicates evaluation of an oracle model where ThingTalk code should be passed to the genienlp server',
        default: false
    });
    parser.add_argument('--offset', {
        required: false,
        type: Number,
        default: 0,
        help: 'Start evaluation from this line of input data',
    });
}

export async function execute(args : any) {
    const tpClient = new Tp.FileClient(args);

    const columns = args.contextual ?
        ['id', 'context', 'sentence', 'target_code', 'prediction'] :
        ['id', 'sentence', 'target_code', 'prediction'];
    const predictionstream = args.predictions
        .pipe(csvparse({ columns, delimiter: '\t', relax: true }))
        .pipe(new StreamUtils.MapAccumulator());
    const predictions = await predictionstream.read();

    const output = readAllLines(args.input_file)
        .pipe(new DatasetParser({ contextual: args.contextual, preserveId: true, parseMultiplePrograms: true, offset: args.offset }))
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
            timezone: args.timezone,
            targetLanguage: args.target_language,
            thingpediaClient: tpClient,
            tokenized: args.tokenized,
            debug: args.debug,
            complexityMetric: args.complexity_metric,
            oracle: args.oracle
        }))
        .pipe(new CollectSentenceStatistics({
            minComplexity: args.min_complexity,
            maxComplexity: args.max_complexity,
            splitByDevice: args.split_by_device
        }));

    const result = await output.read();
    outputResult(args, result);
}
