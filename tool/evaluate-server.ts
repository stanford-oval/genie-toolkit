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
import * as Tp from 'thingpedia';
import * as fs from 'fs';

import { DatasetParser } from '../lib/dataset-tools/parsers';
import { SentenceEvaluatorStream, CollectSentenceStatistics } from '../lib/dataset-tools/evaluation/sentence_evaluator';
import * as ParserClient from '../lib/prediction/parserclient';

import { maybeCreateReadStream, readAllLines } from './lib/argutils';
import { outputResult } from './lib/evaluate-common';

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('evaluate-server', {
        add_help: true,
        description: "Evaluate a trained model on a Genie-generated dataset, by contacting a running Genie server."
    });
    parser.add_argument('-o', '--output', {
        required: false,
        default: process.stdout,
        type: fs.createWriteStream,
        help: "Write results to this file instead of stdout"
    });
    parser.add_argument('--url', {
        required: false,
        help: "URL of the server to evaluate. Use a file:// URL pointing to a model directory to evaluate using a local instance of genienlp",
        default: 'http://127.0.0.1:8400',
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
    parser.add_argument('--thingpedia', {
        required: true,
        help: 'Path to ThingTalk file containing class definitions.'
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
    parser.add_argument('-t', '--target-language', {
        required: false,
        default: 'thingtalk',
        choices: ['thingtalk', 'dlgthingtalk'],
        help: `The programming language to generate`
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
    let tpClient = null;
    if (args.thingpedia)
        tpClient = new Tp.FileClient(args);
    const parser = ParserClient.get(args.url, args.locale);
    await parser.start();

    const output = readAllLines(args.input_file)
        .pipe(new DatasetParser({ contextual: args.contextual, preserveId: true, parseMultiplePrograms: true, offset: args.offset }))
        .pipe(new SentenceEvaluatorStream(parser, {
            locale: args.locale,
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

    await parser.stop();
}
