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


import seedrandom from 'seedrandom';
import * as fs from 'fs';
import Stream from 'stream';

import { DatasetParser, DatasetStringifier } from '../lib/dataset-tools/parsers';
import DatasetSplitter from '../lib/dataset-tools/splitter';
import { maybeCreateReadStream, readAllLines } from './lib/argutils';
import * as StreamUtils from '../lib/utils/stream-utils';
import { coin } from '../lib/utils/random';

export function initArgparse(subparsers) {
    const parser = subparsers.add_parser('split-train-eval', {
        add_help: true,
        description: "Split a dataset into training and development sets."
    });
    parser.add_argument('input_file', {
        nargs: '+',
        type: maybeCreateReadStream,
        help: 'Input datasets to augment (in TSV format); use - for standard input'
    });
    parser.add_argument('-l', '--locale', {
        required: false,
        default: 'en-US',
        help: `BGP 47 locale tag of the language to generate (defaults to 'en-US', English)`
    });
    parser.add_argument('--train', {
        required: true,
        type: fs.createWriteStream,
        help: 'Train file output path',
    });
    parser.add_argument('--eval', {
        required: true,
        type: fs.createWriteStream,
        help: 'Eval file output path',
    });
    parser.add_argument('--test', {
        required: false,
        type: fs.createWriteStream,
        help: 'Test file output path',
        default: null
    });
    parser.add_argument('--eval-probability', {
        type: Number,
        help: 'Eval probability',
        default: 0.1,
    });
    parser.add_argument('--split-strategy', {
        help: 'Method to use to choose training and evaluation sentences',
        default: 'sentence',
        choices: DatasetSplitter.SPLIT_STRATEGIES,
    });
    parser.add_argument('-d', '--device', {
        action: 'append',
        metavar: 'DEVICE',
        help: 'Filter dataset to commands of the given device. This option can be passed multiple times to specify multiple devices',
        dest: 'forDevices',
    });
    parser.add_argument('--contextual', {
        action: 'store_true',
        help: 'Process a contextual dataset.',
        default: false
    });
    parser.add_argument('--eval-on-synthetic', {
        action: 'store_true',
        help: 'Include synthetic data in eval/test.',
        default: false
    });
    parser.add_argument('--subsample', {
        type: Number,
        help: 'Sample a fraction of the dataset',
        default: 1.0
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
        help: 'Random seed',
        default: 'abcdefghi',
    });
}

export async function execute(args) {
    const promises = [];

    const train = new DatasetStringifier();
    const eval_ = new DatasetStringifier();
    promises.push(StreamUtils.waitFinish(train.pipe(args.train)));
    promises.push(StreamUtils.waitFinish(eval_.pipe(args.eval)));
    let test = null;
    if (args.test) {
        test = new DatasetStringifier();
        promises.push(StreamUtils.waitFinish(test.pipe(args.test)));
    }

    const rng = seedrandom.alea(args.random_seed);
    readAllLines(args.input_file)
        .pipe(new DatasetParser({ contextual: args.contextual }))
        .pipe(new Stream.Transform({
            objectMode: true,

            transform(ex, encoding, callback) {
                if (args.subsample >= 1 || coin(args.subsample, rng))
                    this.push(ex);
                callback();
            },

            flush(callback) {
                process.nextTick(callback);
            }
        }))
        .pipe(new DatasetSplitter({
            rng: rng,
            locale: args.locale,
            debug: args.debug,
            evalOnSynthetic: args.eval_on_synthetic,

            train,
            eval: eval_,
            test,

            evalProbability: args.eval_probability,
            forDevices: args.forDevices,
            splitStrategy: args.split_strategy,
        }));

    return Promise.all(promises);
}
