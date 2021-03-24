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
import Stream from 'stream';
import csvparse from 'csv-parse';
import csvstringify from 'csv-stringify';

import * as StreamUtils from '../lib/utils/stream-utils';

interface ParserOptions {
    sentencesPerTask : number;
    idPrefix : string;
    idOffset : number;
}

class Parser extends Stream.Transform {
    private _sentencesPerTask : number;
    private _idPrefix : string;
    private _idOffset : number;

    private _id : number;

    constructor(options : ParserOptions) {
        super({
            readableObjectMode: true,
            writableObjectMode: true
        });

        this._sentencesPerTask = options.sentencesPerTask;
        this._idPrefix = options.idPrefix;
        this._idOffset = options.idOffset;

        this._id = this._idOffset;
    }

    _transform(row : Record<string, string>, encoding : BufferEncoding, callback : () => void) {
        for (let i = 0; i < this._sentencesPerTask; i++) {
            const sentence = row[`Answer.command-${i+1}`];
            if (!sentence || !sentence.trim())
                continue;

            this.push({
                id: this._idPrefix + String(this._id++),
                utterance: sentence.replace(/\n/g, ' ').replace(/"/g, '')
            });
        }
        callback();
    }

    _flush(callback : () => void) {
        process.nextTick(callback);
    }
}

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('mturk-process-eval-data', {
        add_help: true,
        description: "Extract the answers of an MTurk task collecting validation/test data."
    });
    parser.add_argument('-o', '--output', {
        required: true,
        type: fs.createWriteStream
    });
    parser.add_argument('--sentences-per-task', {
        required: false,
        type: Number,
        default: 5,
        help: "Number of sentences in each HIT"
    });
    parser.add_argument('--id-prefix', {
        required: false,
        default: '',
        help: "Prefix for all sentence IDs (to distinguish batches)"
    });
    parser.add_argument('--id-offset', {
        required: false,
        type: Number,
        default: 0,
        help: 'The number to start the id suffix'
    });
    parser.add_argument('input_file', {
        nargs: '+',
        help: 'MTurk result file to choose contexts from, split'
    });
}

export async function execute(args : any) {
    const inputs = args.input_file.map((file : string) => {
        return fs.createReadStream(file, { encoding: 'utf8' })
            .pipe(csvparse({ columns: true, delimiter: ',', relax_column_count: true }));
    });

    await StreamUtils.waitFinish(StreamUtils.chain(inputs, { objectMode: true })
        .pipe(new Parser({ sentencesPerTask: args.sentences_per_task, idPrefix: args.id_prefix, idOffset: args.id_offset }))
        .pipe(csvstringify({ header: true, delimiter: '\t' }))
        .pipe(args.output));
}
