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
import { NUM_SENTENCES_PER_TASK } from './lib/constants';
import { clean } from '../lib/utils/misc-utils';

class ParaphraseHITCreator extends Stream.Transform {
    private _sentencesPerTask : number;
    private _i : number;
    private _buffer : Record<string, string>;

    constructor(sentencesPerTask : number) {
        super({
            readableObjectMode: true,
            writableObjectMode: true,
        });

        this._sentencesPerTask = sentencesPerTask;
        this._i = 0;
        this._buffer = {};
    }

    _transform(row : Record<string, string>, encoding : BufferEncoding, callback : (err ?: Error|null, res ?: Record<string, string>) => void) {
        const i = ++this._i;
        this._buffer[`id${i}`] = row.id;
        if (row.context) {
            this._buffer[`context${i}`] = row.context;
            this._buffer[`context_utterance${i}`] = row.context_utterance;
            if (row.assistant_action.startsWith('slot-fill:')) {
                const param = row.assistant_action.split(':')[1];
                this._buffer[`assistant_action${i}`] = `The assistant asks for the value of ${clean(param)} parameter.`;
            } else if (row.assistant_action === 'result') {
                this._buffer[`assistant_action${i}`] = `The assistant shows the result.`;
            } else if (row.assistant_action === 'confirm') {
                this._buffer[`assistant_action${i}`] = `The assistant confirms the command before executing it.`;
            } else {
                throw new Error(`Invalid assistant action ${row.assistant_action}`);
            }
        }
        this._buffer[`thingtalk${i}`] = row.target_code;
        this._buffer[`sentence${i}`] = row.utterance;

        if (i === this._sentencesPerTask) {
            callback(null, this._buffer);
            this._i = 0;
            this._buffer = {};
        } else {
            callback();
        }
    }

    _flush(callback : () => void) {
        process.nextTick(callback);
    }
}

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('mturk-make-paraphrase-hits', {
        add_help: true,
        description: "Prepare the input file for the manual paraphrase HITs."
    });
    parser.add_argument('-o', '--output', {
        required: true,
        type: fs.createWriteStream
    });
    parser.add_argument('--sentences-per-task', {
        required: false,
        type: Number,
        default: NUM_SENTENCES_PER_TASK,
        help: "Number of sentences in each HIT"
    });
}

export async function execute(args : any) {
    process.stdin.setEncoding('utf8');
    process.stdin
        .pipe(csvparse({ columns: true, delimiter: '\t' }))
        .pipe(new ParaphraseHITCreator(args.sentences_per_task))
        .pipe(csvstringify({ header: true, delimiter: ',' }))
        .pipe(args.output);

    return StreamUtils.waitFinish(args.output);
}
