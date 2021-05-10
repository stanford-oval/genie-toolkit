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
// Author: Silei Xu <silei@cs.stanford.edu>


import * as fs from 'fs';
import JSONStream from 'JSONStream';
import { dumpMap, readJson } from './utils';
import * as StreamUtils from '../../../lib/utils/stream-utils';

export function initArgparse(subparsers) {
    const parser = subparsers.add_parser('wikidata-preprocess-bootleg', {
        add_help: true,
        description: "Preprocess bootleg types. "
    });
    parser.add_argument('--types', {
        required: true,
        help: "Path to the json file that map QID to its type ids"
    });
    parser.add_argument('--type-vocab', {
        required: true,
        help: "Path to the json file that map type names to type id"
    });
    parser.add_argument('--type-vocab-to-qid', {
        required: true,
        help: "Path to the json file that map type names to wikidata QID"
    });
    parser.add_argument('-o', '--output', {
        required: true,
        help: "Path to the output json"
    });
}

export async function execute(args) {
    const typeVocab = await readJson(args.type_vocab);

    const typeQID = new Map(); 
    for (const [name, qid] of await readJson(args.type_vocab_to_qid)) {
        const typeid = typeVocab.get(name);
        typeQID.set(typeid, qid);
    }

    const types = new Map();
    const pipeline = fs.createReadStream(args.types).pipe(JSONStream.parse('$*'));
    pipeline.on('data', async (item) => {
        types.set(item.key, item.value.map((typeId) => typeQID.get(typeId)));
    });
    pipeline.on('error', (error) => console.error(error));
    await StreamUtils.waitEnd(pipeline);
    
    await dumpMap(args.output, types);
}