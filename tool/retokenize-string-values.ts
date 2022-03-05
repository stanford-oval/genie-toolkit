// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2022 The Board of Trustees of the Leland Stanford Junior University
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
// Author: Silei Xu <silei@cs.stanford.edu>

import * as argparse from 'argparse';
import * as fs from 'fs';
import Stream from 'stream';
import csvparse from 'csv-parse';
import * as I18n from '../lib/i18n';

class Retokenizer extends Stream.Transform {
    private _tokenizer : I18n.BaseTokenizer;

    constructor() {
        super({
            readableObjectMode: true,
            writableObjectMode: true
        });
        this._tokenizer = I18n.get('en-US').getTokenizer();
    }

    _transform(row : Record<string, string>, encoding : BufferEncoding, callback : () => void) {
        const tokenized = this._tokenizer.tokenize(row.raw).tokens;
        this.push(`${row.raw}\t${tokenized.join(' ')}\t${row.weight}\n`);
        callback();
    }

    _flush(callback : () => void) {
        process.nextTick(callback);
    }
}

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('retokenize-string-values', {
        add_help: true,
        description: "Retokenize the string parameter dataset."
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
}

export async function execute(args : any) {
    await args.input
        .pipe(csvparse({ columns: ['raw', 'preprocessed', 'weight'], delimiter: '\t', relax: true }))
        .pipe(new Retokenizer())
        .pipe(args.output);
}
