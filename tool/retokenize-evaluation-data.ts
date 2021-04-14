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

import EnglishTokenizer from '../lib/i18n/tokenizer/english';
import { DatasetStringifier, StreamUtils } from '../lib';

const rawUtterances : string[] = [];
class Validator extends Stream.Transform {
    private _update_id;
    private _id_prefix;
    private _counter;
    private _tokenizer;

    constructor(options : { update_id : boolean, id_prefix ?: string }) {
        super({
            readableObjectMode: true,
            writableObjectMode: true
        });

        this._tokenizer = new EnglishTokenizer();
        this._update_id = options.update_id;
        this._id_prefix = options.id_prefix || '';
        this._counter = 0;
    }

    _transform(row : Record<string, string>, encoding : BufferEncoding, callback : () => void) {
        const id = this._update_id ? this._newID() : row.id;
        const raw = rawUtterances[this._counter];
        const tokenized = this._tokenizer.tokenize(raw).tokens;
        this.push({ id, raw, preprocessed: tokenized.join(' '), target_code: row.thingtalk });
        this._counter += 1;
        callback();
    }

    _newID() : string {
        let id = String(this._counter + 1);
        while (id.length < 3) 
            id = '0' + id;
        return this._id_prefix + id;
    }

    _flush(callback : () => void) {
        process.nextTick(callback);
    }
}

class RawUttearnceLoader extends Stream.Transform {
    constructor() {
        super({
            readableObjectMode: true,
            writableObjectMode: true
        });
    }

    _transform(row : Record<string, string>, encoding : BufferEncoding, callback : () => void) {
        rawUtterances.push(row.raw.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
        callback();
    }

    _flush(callback : () => void) {
        process.nextTick(callback);
    }
}

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('retokenize-eval', {
        add_help: true,
        description: "Retokenize the evaluation dataset."
    });
    parser.add_argument('-o', '--output', {
        required: true,
        type: fs.createWriteStream,
        help: 'Path to the updated evaluation dataset'
    });
    parser.add_argument('input', {
        type: fs.createReadStream,
        help: 'Path to the original evaluation dataset'
    });
    parser.add_argument('--raw', {
        type: fs.createReadStream,
        help: 'Path to the file with raw utterances for the evaluation dataset'
    });
    parser.add_argument('--update-id', {
        action: 'store_true',
        default: false,
        help: 'reorder ids for the examples starting from 1'
    });
    parser.add_argument('--id-prefix', {
        default: '',
        required: false,
        help: 'prefix of new id'
    });
}

export async function execute(args : any) {
    const loader = new RawUttearnceLoader();
    await args.raw
        .pipe(csvparse({ columns: ['id', 'raw'], delimiter: '\t', relax: true }))
        .pipe(loader);

    await StreamUtils.waitFinish(loader);

    await args.input
        .pipe(csvparse({ columns: ['id', 'tokenized', 'thingtalk'], delimiter: '\t', relax: true }))
        .pipe(new Validator(args))
        .pipe(new DatasetStringifier())
        .pipe(args.output);
}
