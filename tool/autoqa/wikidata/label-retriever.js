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
// Author: Silei Xu <silei@cs.stanford.edu>

import {
    getItemLabel,
    getPropertyLabel,
} from './utils';

export function initArgparse(subparsers) {
    const parser = subparsers.add_parser('wikidata-label-retriever', {
        add_help: true,
        description: "A script to retrieve Wikidata labels in batch"
    });
    parser.add_argument('input', {
        help: 'a list of properties, split by comma (no space)'
    });
    parser.add_argument('--format', {
        required: false,
        choices: ['label-only', 'id-label', 'label-id'],
        default: 'label-only',
        help: 'the format of the final output'
    });
    parser.add_argument('--delimiter', {
        required: false,
        default: ', ',
        help: 'the delimiter to separate the final output'
    });
}

export async function execute(args) {
    const ids = args.input.split(',');
    const labels = [];
    for (let id of ids) {
        if (id.startsWith('P'))
            labels.push(await getPropertyLabel(id));
        else if (id.startsWith('Q'))
            labels.push(await getItemLabel(id));
        else
            throw new Error(`Invalid Wikidata ID: ${id}`);
    }
    if (args.format === 'label-only') {
        console.log(labels.join(args.delimiter));
    } else if (args.format === 'id-label') {
        const indices = [...Array(ids.length).keys()];
        console.log(indices.map((i) => `${ids[i]} (${labels[i]})`).join(args.delimiter));
    } else if (args.format === 'label-id') {
        const indices = [...Array(ids.length).keys()];
        console.log(indices.map((i) => `${labels[i]} (${ids[i]})`).join(args.delimiter));
    }
}
