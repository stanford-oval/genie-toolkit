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
//          Mehrad Moradshahi <mehrad@cs.stanford.edu>

import * as fs from 'fs';
import * as argparse from 'argparse';

import { DatasetParser, DatasetStringifier } from '../lib/dataset-tools/parsers';
import parallelize from '../lib/utils/parallelize';

import * as StreamUtils from '../lib/utils/stream-utils';
import { maybeCreateReadStream, readAllLines } from './lib/argutils';
import ProgressBar from './lib/progress_bar';

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('augment', {
        add_help: true,
        description: "Apply parameter replacement and misc augmentations on a Genie dataset."
    });
    parser.add_argument('-o', '--output', {
        required: true,
        type: fs.createWriteStream
    });
    parser.add_argument('-l', '--locale', {
        required: false,
        default: 'en-US',
        help: `BGP 47 locale tag of the language to generate (defaults to 'en-US', English)`
    });
    parser.add_argument('--param-locale', {
        required: false,
        help: `BGP 47 locale tag of the language for parameter values (defaults to the same value as --locale)`
    });
    parser.add_argument('-t', '--target-language', {
        required: false,
        default: 'thingtalk',
        choices: ['thingtalk', 'dlgthingtalk'],
        help: `The programming language to generate`
    });
    parser.add_argument('--thingpedia', {
        required: true,
        help: 'Path to ThingTalk file containing class definitions.'
    });
    parser.add_argument('--parameter-datasets', {
        required: true,
        help: 'TSV file containing the paths to datasets for strings and entity types.'
    });
    parser.add_argument('input_file', {
        nargs: '+',
        type: maybeCreateReadStream,
        help: 'Input datasets to augment (in TSV format); use - for standard input'
    });
    parser.add_argument('--contextual', {
        action: 'store_true',
        help: 'Process a contextual dataset.',
        default: false
    });
    parser.add_argument('--quoted-fraction', {
        type: Number,
        default: 0.1,
        metavar: 'FRACTION',
        help: 'Fraction of sentences that will not have their quoted parameters replaced',
    });
    parser.add_argument('--untyped-string-probability', {
        type: Number,
        default: 0.0,
        metavar: 'FRACTION',
        help: 'Fraction of sentences that will have generic text in their string parameters'
    });
    parser.add_argument('--max-span-length', {
        type: Number,
        default: 10,
        metavar: 'LENGTH',
        help: 'Maximum length of a string parameter (in words)'
    });
    parser.add_argument('--synthetic-expand-factor', {
        type: Number,
        default: 5,
        metavar: 'FACTOR',
        help: 'Expansion factor of synthetic sentences (including augmented synthetic)'
    });
    parser.add_argument('--quoted-paraphrasing-expand-factor', {
        type: Number,
        default: 30,
        metavar: 'FACTOR',
        help: 'Expansion factor of paraphrased sentences with quoted parameters'
    });
    parser.add_argument('--no-quote-paraphrasing-expand-factor', {
        type: Number,
        default: 10,
        metavar: 'FACTOR',
        help: 'Expansion factor of paraphrased sentences without quoted parameters)'
    });
    parser.add_argument('--single-device-expand-factor', {
        type: Number,
        default: 1,
        metavar: 'FACTOR',
        help: 'Number of sentences to generate with "ask" or "tell" prefixes for single-device commands'
    });
    parser.add_argument('--replace-locations', {
        action: 'store_true',
        help: 'Replace LOCATION tokens with unquoted locations.',
        default: true
    });
    parser.add_argument('--no-replace-locations', {
        action: 'store_false',
        dest: 'replace_locations',
        help: 'Do not replace LOCATION tokens with unquoted locations.',
    });
    parser.add_argument('--replace-numbers', {
        action: 'store_true',
        help: 'Replace NUMBER tokens with actual values.',
        default: false
    });
    parser.add_argument('--no-replace-numbers', {
        action: 'store_false',
        dest: 'replace_numbers',
        help: 'Do not replace NUMBER tokens',
    });
    parser.add_argument('--requotable', {
        action: 'store_true',
        help: 'Replace parameters in a way that they can be requoted later (defaults to true).',
        default: true
    });
    parser.add_argument('--no-requotable', {
        action: 'store_false',
        dest: 'requotable',
        help: 'Allow the replacement of a parameter in the sentence and in the program to differ (making requoting impossible).',
    });
    parser.add_argument('--clean-parameters', {
        action: 'store_true',
        help: 'Take extra effort to use parameters that are simple and do not include punctuation marks',
        default: false
    });
    parser.add_argument('--sampling-type', {
        choices: ['default', 'random', 'uniform', 'sequential'],
        help: 'Random/ Uniform strategy assigns random/ uniform weights to parameters instead of reading from file ' +
            'sequential is deterministic sampling. It starts from the beginning and picks the first one that passes all sample filterings',
        default: false
    });
    parser.add_argument('--subset-param-set', {
        required: false,
        default: '0.0-1.0',
        help: `Only use a subset of parameter dataset for augmentation in the range {beg}-{end}`
    });
    parser.add_argument('--num-attempts', {
        type: Number,
        default: 10000,
        help: 'Maximum number of attempts to replace a parameter value'
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
    parser.add_argument('--random-seed', {
        default: 'almond is awesome',
        help: 'Random seed'
    });
    parser.add_argument('--parallelize', {
        type: Number,
        help: 'Run N threads in parallel (requires --experimental-worker support)',
        metavar: 'N',
        default: 1,
    });
    parser.add_argument('--override-flags', {
        required: false,
        default: '',
        help: 'Override input sentence flags with the provided flag(s)'
    });
}

export async function execute(args : any) {
    const inputFile = readAllLines(args.input_file);
    const outputFile = args.output;
    if (!args.param_locale)
        args.param_locale = args.locale;

    const counter = new StreamUtils.CountStream();

    delete args.input_file;
    delete args.output;
    inputFile
        .pipe(new DatasetParser({ contextual: args.contextual, overrideFlags: args.override_flags, parseMultiplePrograms: true }))
        .pipe(counter)
        .pipe(await parallelize(args.parallelize, require.resolve('./workers/augment-worker'), args))
        .pipe(new DatasetStringifier())
        .pipe(outputFile);

    if (!args.debug) {
        const progbar = new ProgressBar(1);
        counter.on('progress', (value) => {
            //console.log(value);
            progbar.update(value);
        });

        // issue an update now to show the progress bar
        progbar.update(0);
    }

    await StreamUtils.waitFinish(outputFile);
}
