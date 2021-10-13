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



import assert from 'assert';
import * as fs from 'fs';
import util from 'util';
import * as ThingTalk from 'thingtalk';
import * as crypto from 'crypto';

import * as StreamUtils from '../../../lib/utils/stream-utils';

import { makeMetadata } from '../lib/metadata';
import { cleanEnumValue } from '../lib/utils';

function hash(obj) {
    const str = JSON.stringify(obj);
    const hasher = crypto.createHash('sha1');
    hasher.update(str);
    return hasher.digest().toString('hex');
}

class Normalizer {
    constructor() {
        // metadata for each schema.org type
        this.meta = {};

        // the normalized file
        this.output = {};
    }

    async init(thingpedia) {
        const library = ThingTalk.Library.parse(await util.promisify(fs.readFile)(thingpedia, { encoding: 'utf8' }));
        assert(library instanceof ThingTalk.Ast.Library && library.classes.length === 1);
        const classDef = library.classes[0];
        this._classDef = classDef;

        for (let fn in classDef.queries) {
            const fndef = classDef.queries[fn];
            this.meta[fn] = {
                extends: [],
                fields: makeMetadata('com.google.sgd', fndef.args.map((argname) => fndef.getArgument(argname)))
            };
        }

        for (let fn in classDef.actions) {
            const fndef = classDef.actions[fn];
            this.meta[fn] = {
                extends: [],
                fields: makeMetadata('com.google.sgd', fndef.args.map((argname) => fndef.getArgument(argname)))
            };
        }
    }

    _processField(fname, arg, value) {
        const expectedType = this.meta[fname].fields[arg];

        if (value === null || value === undefined) {
            if (expectedType.isArray)
                return [];
            else
                return undefined;
        }

        if (expectedType.isArray && !Array.isArray(value)) {
            value = [value];
        } else if (!expectedType.isArray && Array.isArray(value)) {
            console.error(`Unexpected array for ${arg}`);
            if (value.length === 0)
                return undefined;
            value = value[0];
        }

        assert.strictEqual(typeof value, 'string');
        if (typeof expectedType.type === 'string') {
            if (expectedType.type === 'tt:Currency') {
                if (/^\s*(?:[0-9]+|\.[0-9]+)\s+[a-zA-Z]+/.test(String(value))) {
                    const [, num, currency] = /^\s*(?:[0-9]+|\.[0-9]+)\s+[a-zA-Z]+/.exec(String(value));
                    return { value: num, code: currency.toLowerCase() };
                }
                return { value: parseFloat(value), code: 'usd' };
            } else if (expectedType.type === 'tt:Number') {
                return parseFloat(value);
            } else if (expectedType.type === 'tt:Duration') {
                return ThingTalk.Units.transformToBaseUnit(parseFloat(value), 'min');
            } else if (expectedType.type === 'tt:Measure') {
                if (arg === 'temperature')
                    return ThingTalk.Units.transformToBaseUnit(parseFloat(value), 'F');
                if (arg === 'wind')
                    return ThingTalk.Units.transformToBaseUnit(parseFloat(value), 'mph');
                throw new Error(`Not recognized measurement type`);
            } else if (expectedType.type.startsWith('tt:Enum(')) {
                const enumerands = expectedType.type.substring('tt:Enum('.length, expectedType.type.length - 1).split(/,/g);
                value = cleanEnumValue(value);
                if (value === undefined || value === 'Dontcare')
                    return undefined;
                if (!enumerands.includes(value)) {
                    console.error(`Expected enumerated value for ${arg}, got`, value);
                    return undefined;
                }
                return value;
            } else if (expectedType.type === 'tt:EntityLower') {
                return String(value).toLowerCase();
            } else {
                return String(value);
            }
        }

        if (typeof expectedType.type === 'object') {
            if (expectedType.type.latitude && expectedType.type.longitude) {
                return {
                    display: String(value),
                    latitude: null,
                    longitude: null
                };
            }
        }

        return String(value);
    }

    _processResult(fname, result) {
        const hashId = 'https://thingpedia.stanford.edu/ns/uuid/sgd/' + hash(result);

        if (hashId in this.output[fname])
            return;

        const processed = { '@id': hashId, '@type': fname };
        for (let arg in result)
            processed[arg] = this._processField(fname, arg, result[arg]);
        this.output[fname][hashId] = processed;
    }

    async process(filename) {
        let input = JSON.parse(await util.promisify(fs.readFile)(filename), { encoding: 'utf8' });
        for (let dialog of input) {
            for (let turn of dialog.turns) {
                for (let frame of turn.frames) {
                    if (!('service_call' in frame))
                        continue;
                    if (!('service_results' in frame) || frame.service_results.length === 0)
                        continue;

                    let fname = frame.service + '_' + frame.service_call.method;
                    if (!(fname in this.meta))
                        continue;

                    if (!(fname in this.output))
                        this.output[fname] = {};

                    for (let result of frame.service_results)
                        this._processResult(fname, result);
                }
            }
        }
    }
}

export function initArgparse(subparsers) {
    const parser = subparsers.add_parser('sgd-normalize-data', {
        add_help: true,
        description: "Generate normalized data from dialogs to match their ThingTalk representation."
    });
    parser.add_argument('--data-output', {
        type: fs.createWriteStream
    });
    parser.add_argument('--meta-output', {
        type: fs.createWriteStream
    });
    parser.add_argument('--thingpedia', {
        required: true,
        help: 'Path to ThingTalk file containing class definitions.'
    });
    parser.add_argument('input_file', {
        nargs: '+',
        help: 'Input JSON+LD files to normalize. Multiple input files will be merged in one.'
    });
}

export async function execute(args) {
    const normalizer = new Normalizer();
    await normalizer.init(args.thingpedia);
    for (let filename of args.input_file)
        await normalizer.process(filename);

    if (args.meta_output) {
        args.meta_output.end(JSON.stringify(normalizer.meta, undefined, 2));
        await StreamUtils.waitFinish(args.meta_output);
    }

    if (args.data_output) {
        args.data_output.end(JSON.stringify(normalizer.output, undefined, 2));
        await StreamUtils.waitFinish(args.data_output);
    }
}
