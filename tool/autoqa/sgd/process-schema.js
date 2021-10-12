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

import * as fs from 'fs';
import util from 'util';
import assert from 'assert';

import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';
const Type = ThingTalk.Type;
const Ast = ThingTalk.Ast;

import { clean } from '../../../lib/utils/misc-utils';
import * as StreamUtils from '../../../lib/utils/stream-utils';

import genBaseCanonical from '../lib/base-canonical-generator';
import { PROPERTY_TYPE_OVERRIDE, STRING_FILE_OVERRIDES } from './manual-annotations';
import { cleanEnumValue } from '../lib/utils';

function predictType(slot) {
    if (slot.name in PROPERTY_TYPE_OVERRIDE)
        return PROPERTY_TYPE_OVERRIDE[slot.name];
    if (slot.is_categorical && slot.possible_values.length > 0) {
        if (slot.possible_values.length === 2
            && slot.possible_values.includes('True')
            && slot.possible_values.includes('False'))
            return Type.Boolean;
        if (slot.possible_values.every((v) => !isNaN(v)))
            return Type.Number;
        return new Type.Enum(slot.possible_values.map(cleanEnumValue));
    }
    if (slot.name === 'phone_number')
        return new Type.Entity('tt:phone_number');
    if (slot.name.startsWith('number_of_') || slot.name.endsWith('_number') || slot.name === 'number' ||
        slot.name.endsWith('_size') || slot.name === 'size' ||
        slot.name.endsWith('_rating') || slot.name === 'rating')
        return Type.Number;
    if (slot.name.endsWith('_time') || slot.name === 'time')
        return Type.Time;
    if (slot.name.endsWith('_date') || slot.name === 'date')
        return Type.Date;
    if (slot.name.endsWith('_location') || slot.name === 'location' ||
        slot.name.endsWith('_address') || slot.name === 'address')
        return Type.Location;
    if (slot.name.endsWith('_fare') || slot.name === 'fare' ||
        slot.name.endsWith('_price') || slot.name === 'price')
        return Type.Currency;

    return Type.String;
}

class SchemaProcessor {
    constructor(args) {
        this._output = args.output;
        this._cache = args.cache_file;
        this._url = args.url;
        this._manual = args.manual;
        this._queryOnly = args.query_only;
        this._include = args.include ? args.include.split(',') : null;
        this._exclude = args.exclude ? args.exclude.split(',') : null;
    }

    async run() {
        let schema;
        if (await util.promisify(fs.exists)(this._cache)) {
            schema = await util.promisify(fs.readFile)(this._cache, { encoding: 'utf8' });
        } else {
            schema = await Tp.Helpers.Http.get(this._url);
            await util.promisify(fs.writeFile)(this._cache, schema);
        }

        let queries = {};
        let actions = {};
        for (let service of JSON.parse(schema)) {
            if (this._include && !this._include.includes(service.service_name))
                continue;
            else if (this._exclude && this._exclude.includes(service.service_name))
                continue;
            // if include & exclude are both missing, use first available service for conflicted ones
            else if (!this._include && !this._exclude && !service.service_name.endsWith('_1'))
                continue;

            let slots = {};
            for (let slot of service.slots) {
                let type = predictType(slot);
                const canonical = {};
                genBaseCanonical(canonical, slot.name, type);

                slots[slot.name] = {
                    type,
                    annotations: {
                        nl: { canonical },
                        impl: { description: new Ast.Value.String(slot.description) }
                    }
                };
                if (type.isString) {
                    const fileId = `com.google.sgd:${service.service_name}_${slot.name}`;
                    slots[slot.name].annotations.impl['string_values'] =
                        new Ast.Value.String(STRING_FILE_OVERRIDES[slot.name] || fileId);
                }
                if (type.isNumber && slot.possible_values.length > 0) {
                    let min_number = parseInt(slot.possible_values[0]);
                    let max_number = parseInt(slot.possible_values[slot.possible_values.length - 1]);
                    slots[slot.name].annotations.impl['min_number'] = new Ast.Value.Number(min_number);
                    slots[slot.name].annotations.impl['max_number'] = new Ast.Value.Number(max_number);
                }
            }

            for (let intent of service.intents) {
                let name = service.service_name + '_' + intent.name;

                let functionType = intent.is_transactional ? 'action' : 'query';
                if (this._queryOnly && functionType === 'action')
                    continue;

                let args = [];
                for (let arg of intent.required_slots) {
                    let type = slots[arg].type;
                    let annotations = slots[arg].annotations;
                    if (functionType === 'action') {
                        args.push(new Ast.ArgumentDef(null, Ast.ArgDirection.IN_REQ, arg, type, annotations));
                    } else {
                        // all query parameters are out parameters for now
                        args.push(new Ast.ArgumentDef(null, Ast.ArgDirection.OUT, arg, type, annotations));
                    }
                }
                for (let arg of Object.keys(intent.optional_slots)) {
                    let type = slots[arg].type;
                    let annotations = slots[arg].annotations;
                    if (functionType === 'action') {
                        args.push(new Ast.ArgumentDef(null, Ast.ArgDirection.IN_OPT, arg, type, annotations));
                    } else {
                        // all query parameters are out parameters for now
                        args.push(new Ast.ArgumentDef(null, Ast.ArgDirection.OUT, arg, type, annotations));
                    }
                }
                for (let arg of intent.result_slots) {
                    // results_slots also includes args in required/optional slots, skip them
                    if (intent.required_slots.includes(arg) || Object.keys(intent.optional_slots).includes(arg))
                        continue;
                    let type = slots[arg].type;
                    // for now, result slots are non-filterable as they are never queried for in dialogues
                    slots[arg].annotations.impl['filterable'] = new Ast.Value.Boolean(false);
                    let annotations = slots[arg].annotations;
                    args.push(new Ast.ArgumentDef(null, Ast.ArgDirection.OUT, arg, type, annotations));
                }

                let functionDef = new Ast.FunctionDef(null, functionType, null, name, null, {
                        is_list: true,
                        is_monitorable: false,
                }, args, {
                        nl: { canonical: clean(intent.name), confirmation: clean(intent.name) },
                        impl: { description: new Ast.Value.String(intent.description) }
                });
                if (functionType === 'query')
                    queries[name] = functionDef;
                else
                    actions[name] = functionDef;
            }
        }

        const imports = [
            new Ast.MixinImportStmt(null, ['loader'], 'org.thingpedia.v2', []),
            new Ast.MixinImportStmt(null, ['config'], 'org.thingpedia.config.none', [])
        ];

        const classdef = new Ast.ClassDef(null, 'com.google.sgd', null,
            { imports, queries, actions }, {
                nl: {
                    name: `Google SDG`,
                    description: 'Services in Google schema-guided dialog dataset'
                },
            }, {
                is_abstract: false
            });

        this._output.end(classdef.prettyprint());
        await StreamUtils.waitFinish(this._output);
    }
}


export function initArgparse(subparsers) {
    const parser = subparsers.add_parser('sgd-process-schema', {
        add_help: true,
        description: "Process a schema JSON definition into a Thingpedia class."
    });
    parser.add_argument('-o', '--output', {
        required: true,
        type: fs.createWriteStream
    });
    parser.add_argument('--cache-file', {
        required: false,
        default: './schema.json',
        help: 'Path to a cache file containing the schema definitions.'
    });
    parser.add_argument('--url', {
        required: false,
        default: 'https://raw.githubusercontent.com/google-research-datasets/dstc8-schema-guided-dialogue/master/train/schema.json',
        help: 'The URL to retrieve the schema.'
    });
    parser.add_argument('--manual', {
        action: 'store_true',
        help: 'Enable manual annotations.',
        default: false
    });
    parser.add_argument('--query-only', {
        action: 'store_true',
        help: 'Enable manual annotations.',
        default: false
    });
    parser.add_argument('--include', {
        required: false,
        default: null,
        help: 'services to include in the schema, split by comma (no space)'
    });
    parser.add_argument('--exclude', {
        required: false,
        default: null,
        help: 'services to exclude in the schema, split by comma (no space)'
    });
}

export async function execute(args) {
    // include & exclude cannot be specified at the same time
    assert(!args.include || !args.exclude);
    const schemaProcessor = new SchemaProcessor(args);
    schemaProcessor.run();
}
