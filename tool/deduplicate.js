// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
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
import { maybeCreateReadStream, readAllLines } from './lib/argutils';
import * as StreamUtils from '../lib/utils/stream-utils';

export function initArgparse(subparsers) {
    const parser = subparsers.add_parser('deduplicate', {
        add_help: true,
        description: "Deduplicate a dataset (remove identical utterances or pairs of context, utterance)."
    });
    parser.add_argument('-o', '--output', {
        required: true,
        type: fs.createWriteStream
    });
    parser.add_argument('--contextual', {
        action: 'store_true',
        help: 'Process a contextual dataset.',
        default: false
    });
    parser.add_argument('input_file', {
        nargs: '+',
        type: maybeCreateReadStream,
        help: 'Input datasets to evaluate (in TSV format); use - for standard input'
    });
}

export async function execute(args) {
    function getDedupeKey(ex) {
        if (args.contextual)
            return ex.context + ' <sep> ' + ex.preprocessed;
        else
            return ex.preprocessed;
    }
    const dedupeMap = new Set;

    readAllLines(args.input_file)
        .pipe(new DatasetParser({ contextual: args.contextual }))
        .pipe(new Stream.Transform({
            objectMode: true,

            transform(ex, encoding, callback) {
                const key = getDedupeKey(ex);
                if (!dedupeMap.has(key)) {
                    dedupeMap.add(key);
                    this.push(ex);
                }
                callback();
            },

            flush(callback) {
                process.nextTick(callback);
            }
        }))
        .pipe(new DatasetStringifier())
        .pipe(args.output);

    await StreamUtils.waitFinish(args.output);
}
