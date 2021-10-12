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


// Parse a .jsonld file and normalize it based on how we expect schema.org to look like

import assert from 'assert';
import * as fs from 'fs';
import util from 'util';
//import assert from 'assert';
import * as ThingTalk from 'thingtalk';
import * as crypto from 'crypto';

import * as StreamUtils from '../../../lib/utils/stream-utils';

import { makeMetadata } from '../lib/metadata';

import {
    PROPERTY_RENAMES,
    ENUM_VALUE_NORMALIZE
} from './manual-annotations';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

function parseDuration(form) {
    const match = /^P([0-9]+Y)?([0-9]+M)?([0-9]+D)?T?([0-9]+H)?([0-9]+M)?([0-9]+S)?/.exec(form);

    const [, year, month, day, hour, minute, second] = match;

    let value = 0;
    if (year)
        value += parseInt(year) * YEAR;
    if (month)
        value += parseInt(month) * MONTH;
    if (day)
        value += parseInt(day) * DAY;
    if (hour)
        value += parseInt(hour) * HOUR;
    if (minute)
        value += parseInt(minute) * MINUTE;
    if (second)
        value += parseInt(second) * SECOND;
    return value;
}

const MEASURE_UNIT_REMAP = {
    'calories': 'kcal',
};

function parseMeasure(str) {
    const match = /^(-?(?:(?:0|[1-9][0-9]*)\.[0-9]*(?:[eE][+-]?[0-9]+)?|\.[0-9]+(?:[eE][+-]?[0-9]+)?|(?:0|[1-9][0-9]*)(?:[eE][+-]?[0-9]+)?))\s+([a-zA-Z]+)$/.exec(str);
    if (!match) {
        console.error(`Invalid measurement value ${str}`);
        return undefined;
    }

    let [, value, unit] = match;
    if (MEASURE_UNIT_REMAP[unit])
        unit = MEASURE_UNIT_REMAP[unit];

    try {
        ThingTalk.Units.normalizeUnit(unit);
    } catch(e) {
        console.error(`Invalid measurement unit ${unit}`);
        return undefined;
    }

    return ThingTalk.Units.transformToBaseUnit(parseFloat(value), unit);
}

function ensureArray(value) {
    if (Array.isArray(value))
        return value;
    else
        return [value];
}

function hash(obj) {
    const str = JSON.stringify(obj);
    const hasher = crypto.createHash('sha1');
    hasher.update(str);
    return hasher.digest().toString('hex');
}

class Normalizer {
    constructor(className) {
        // metadata for each schema.org type
        this.meta = {};

        // the normalized file
        this.output = {};

        // deduplicate according to sameAs
        this._sameAsMap = new Map;

        // deduplication of warnings
        this._warnings = new Set;

        // the prefix of the class name, default to org.schema
        this._className = className;
    }

    async init(thingpedia) {
        const library = ThingTalk.Syntax.parse(await util.promisify(fs.readFile)(thingpedia, { encoding: 'utf8' }));
        assert(library instanceof ThingTalk.Ast.Library && library.classes.length === 1);
        const classDef = library.classes[0];
        this._classDef = classDef;

        for (let fn in classDef.queries) {
            const fndef = classDef.queries[fn];
            this.meta[fn] = {
                extends: fndef.extends,
                fields: makeMetadata(this._className, fndef.args.map((argname) => fndef.getArgument(argname)))
            };
        }
    }

    _applyPropertyRenames(obj) {
        for (let prop in obj) {
            let renamed = PROPERTY_RENAMES[prop];
            if (renamed && !Object.prototype.hasOwnProperty.call(obj, renamed)) {
                obj[renamed] = obj[prop];
                delete obj[prop];
            }
        }
    }

    _warnField(path, fieldname) {
        path = path.join('.');
        const key = path + '.' + fieldname;
        if (this._warnings.has(key))
            return;
        this._warnings.add(key);
        console.log(`${path} has unexpected field ${fieldname}`);
    }

    _checkUnexpectedFields(obj, type) {
        const querydef = this._classDef.queries[type];
        if (!querydef)
            return;

        for (let field in obj) {
            if (field === '@id' || field === 'name' || field === '@type' || field === '@context' || field === 'sameAs')
                continue;

            if (!querydef.hasArgument(field)) {
                this._warnField([type], field);
                delete obj[field];
            }
        }
    }

    _mergeObject(into, value) {
        for (let prop in value) {
            if (prop === '@id' || prop === '@type' || prop === '@context' || prop === 'sameAs')
                continue;
            if (!value[prop])
                continue;
            if (Array.isArray(value[prop]) && value[prop].length === 0)
                continue;

            if (Array.isArray(value[prop]))
                into[prop] = value[prop];
            else if (into[prop] && typeof value[prop] === 'object')
                this._mergeObject(into[prop], value[prop]);
            else
                into[prop] = value[prop];
        }
    }

    _processObject(value, type, visitedTypes = new Set) {
        const typemeta = this.meta[type];
        if (!typemeta) {
            if (!type.endsWith('Action'))
                console.error(`Unrecognized object type ${type}`);
            return undefined;
        }

        // if the same base class comes through multiple paths, avoid
        // visiting twice and duplicating the objects
        if (visitedTypes.has(type))
            return true;
        visitedTypes.add(type);

        for (let base of typemeta.extends) {
            if (!this._processObject(value, base, visitedTypes))
                return undefined;
        }

        for (let field in typemeta.fields) {
            const expectedType = typemeta.fields[field];
            value[field] = this._processField(value[field], [type, field], expectedType);
        }

        if (type === value['@type']) {
            // at the bottom of the type hierarchy, we also check for @id and add to the output

            if (!this.output[type])
                this.output[type] = {};

            // if we don't have an ID, but we have a string sameAs, we treat it as the ID
            if (!value['@id'] && typeof value.sameAs === 'string')
                value['@id'] = value.sameAs;

            // if we don't have an ID, but we have a string url, we treat it as the ID
            if (!value['@id'] && typeof value.url === 'string')
                value['@id'] = value.url;

            if (type === 'Restaurant') {
                // dedupe restaurants by name
                const sameAs = ensureArray(value.sameAs || []);
                sameAs.push('Restaurant/name:' + value.name);
                value.sameAs = sameAs;
            }

            // if we already have an ID, we're done
            if (value['@id']) {
                const existing = this._sameAsMap.get(value['@id']);
                if (existing) {
                    this._mergeObject(existing, value);
                    return value['@id'];
                }

                this.output[type][value['@id']] = value;
                this._sameAsMap.set(value['@id'], value);
                if (value.sameAs) {
                    for (let sameAs of ensureArray(value.sameAs))
                        this._sameAsMap.set(sameAs, value);
                }
                delete value.sameAs;
                //console.error((output['Restaurant'] || []).length);
                return value['@id'];
            }

            // otherwise we're going to make one up
            //
            // see if we already have an object that is identical to this one

            if (value.sameAs) {
                for (let sameAs of ensureArray(value.sameAs)) {
                    const existing = this._sameAsMap.get(sameAs);
                    if (existing) {
                        this._mergeObject(existing, value);
                        return existing['@id'];
                    }
                }
            }

            value['@id'] = undefined;
            const hashId = 'https://thingpedia.stanford.edu/ns/uuid/' + type + '/' + hash(value);
            if (this._sameAsMap.has(hashId)) {
                const existing = this._sameAsMap.get(hashId);
                if (existing) {
                    this._mergeObject(existing, value);
                    return existing['@id'];
                }
            }

            // nope, make up a new object
            value['@id'] = hashId;
            this.output[type][value['@id']] = value;
            this._sameAsMap.set(value['@id'], value);
            if (value.sameAs) {
                for (let sameAs of ensureArray(value.sameAs))
                    this._sameAsMap.set(sameAs, value);
            }
            delete value.sameAs;

            return value['@id'];
        }

        return true;
    }

    _processField(value, path, expectedType, parent) {
        if (value === null || value === undefined) {
            if (expectedType.isArray)
                return [];
            else
                return undefined;
        }

        if (Array.isArray(value))
            value = value.filter(Boolean);

        if (expectedType.isArray && !Array.isArray(value)) {
            value = [value];
        } else if (!expectedType.isArray && Array.isArray(value)) {
            console.error(`Unexpected array in ${path.join('.')}`);
            if (value.length === 0)
                return undefined;
            value = value[0];
        }


        if (expectedType.isArray) {
            const innerExpected = { isArray: false, type: expectedType.type };

            const newArray = [];
            for (let i = 0; i < value.length; i++) {
                path.push(i);
                const newValue = this._processField(value[i], path, innerExpected, parent);
                if (newValue !== undefined)
                    newArray.push(newValue);
                path.pop();
            }

            return newArray;
        }

        if (typeof expectedType.type === 'string') {
            // entity of builtin type

            if (expectedType.type.startsWith('tt:')) {
                if (typeof value === 'object') {
                    if (expectedType.type === 'tt:Entity' && value.url)
                        return String(value.url);

                    if (expectedType.type === 'tt:Entity' &&
                        value['@type'] === 'ImageObject' &&
                        value.contentUrl)
                        return String(value.contentUrl);
                    if (expectedType.type === 'tt:Entity' &&
                        (value['@type'] === 'ImageObject' || value['@type'] === 'Photograph') &&
                        value.thumbnailUrl)
                        return String(value.thumbnailUrl);

                    if (expectedType.type === 'tt:String' &&
                        value['@type'] === 'HowToStep' &&
                        value.text)
                        return String(value.text);

                    console.error(`Unexpected object in ${path.join('.')}, expected a ${expectedType.type}`);
                    console.error(value);


                    return undefined;
                }

                if (expectedType.type === 'tt:Currency') {
                    if (/^\s*(?:[0-9]+|\.[0-9]+)\s+[a-zA-Z]+/.test(String(value))) {
                        const [, num, currency] = /^\s*(?:[0-9]+|\.[0-9]+)\s+[a-zA-Z]+/.exec(String(value));
                        return { value: num, code: currency.toLowerCase() };
                    }
                    const prop = path[path.length-1];
                    if (parent && (prop + 'Currency') in parent)
                        return { value: parseFloat(value), code: parent[prop + 'Currency'].toLowerCase() };

                    return { value: parseFloat(value), code: 'usd' };
                } else if (expectedType.type === 'tt:Number') {
                    return parseFloat(value);
                } else if (expectedType.type === 'tt:Duration') {
                    return parseDuration(value);
                } else if (expectedType.type === 'tt:Measure') {
                    return parseMeasure(value);
                } else if (expectedType.type.startsWith('tt:Enum(')) {
                    const enumerands = expectedType.type.substring('tt:Enum('.length, expectedType.type.length-1).split(/,/g);
                    // remove https://schema.org/ prefix from enumerated value, if present
                    value = value.replace(/^https?:\/\/schema\.org\/?/, '');
                    // camelcase the value
                    value = value.replace(/(?:^|\s+)[A-Za-z]/g, (letter) => letter.trim().toUpperCase());

                    const prop = path[path.length-1];
                    if (prop in ENUM_VALUE_NORMALIZE && value in ENUM_VALUE_NORMALIZE[prop])
                        value = ENUM_VALUE_NORMALIZE[prop][value];
                    if (value === undefined)
                        return undefined;

                    if (!enumerands.includes(value)) {
                        console.error(`Expected enumerated value in ${path.join('.')}, got`, value);
                        return undefined;
                    }
                    return value;
                } else if (expectedType.type === 'tt:EntityLower') {
                    return String(value).toLowerCase();
                } else {
                    return String(value);
                }
            } else {
                if (typeof value === 'object') {
                    let nestedtype = value['@type'];
                    if (typeof nestedtype !== 'string' || !nestedtype) {
                        //console.error(`Nested object has no @type in ${path.join('.')}, assuming ${expectedType.type}`);

                        // add a type and hope for the best
                        if (typeof value.type === 'string' && value.type) {
                            nestedtype = value['@type'] = value.type;
                            delete value.type;
                        } else {
                            nestedtype = value['@type'] = expectedType.type;
                        }
                    }
                    this._applyPropertyRenames(value);
                    this._checkUnexpectedFields(value, nestedtype);
                    return this._processObject(value, nestedtype);
                } else {
                    value = String(value);

                    if (!value.startsWith('http')) {
                        // not URI-like, make up something

                        return this._processObject({ name: value, '@type': expectedType.type }, expectedType.type);
                    } else {
                        return value;
                    }
                }
            }
        } else {
            // compound type

            if (typeof value !== 'object') {
                console.error(`Expected object in ${path.join('.')}, got`, value);

                // if we have a name, make up something...
                if ('name' in expectedType.type)
                    return { name: value };
                else
                    return undefined;
            }

            this._applyPropertyRenames(value);
            for (let field in value) {
                if (field === '@id' || field === '@type' || field === '@context')
                    continue;

                if (!(field in expectedType.type)) {
                    this._warnField(path, field);
                    delete value[field];
                }
            }

            for (let field in expectedType.type) {
                path.push(field);
                value[field] = this._processField(value[field], path, expectedType.type[field], value);
                path.pop();
            }

            return value;
        }
    }

    /**
     * Preprocess raw data file
     * We observe two different format in practice:
     *
     * format 1:
     * {
     *   "@context": "http://schema.org",
     *   "@type": "Movie",
     *   "url": "/title/tt0050083/",
     *   "name": "12 Angry Men"
     * }
     *
     * format 2:
     * {
     *   "@type": "http://schema.org/Movie",
     *   "properties": {
     *     "url": "/title/tt0050083/",
     *     "name": "12 Angry Men"
     *   }
     * }
     *
     * here, we normalize to format 1
     */
    _preprocess(input) {
        if (!input || typeof input !== 'object')
            return input;
        if (Array.isArray(input))
            return input.map((input) => this._preprocess(input));

        if (!('@type' in input) && 'type' in input) {
            input['@type'] = input.type;
            delete input.type;
        }
        if ('@type' in input && input['@type'].startsWith('http://schema.org/'))
            input['@type'] = input['@type'].slice('http://schema.org/'.length);

        if ('properties' in input) {
            for (let field in input.properties)
                input[field] = input.properties[field];
            delete input.properties;
        }

        for (let field in input) {
            if (typeof input[field] === 'object' && input[field] !== null)
                input[field] = this._preprocess(input[field]);
        }
        return input;
    }

    async process(filename) {
        console.error('filename', filename);
        let input = JSON.parse(await util.promisify(fs.readFile)(filename), { encoding: 'utf8' });

        input = this._preprocess(input);
        if (!Array.isArray(input))
            input = [input];

        for (let value of input) {
            if (!Array.isArray(value))
                value = [value];
            for (let elem of value) {
                let type = elem['@type'];
                if (typeof type !== 'string' || !type) {
                    if (typeof elem.type === 'string' && elem.type) {
                        type = elem['@type'] = elem.type;
                        delete elem.type;
                    } else {
                        console.error(`Top-level object has no @type`, elem);
                        continue;
                    }
                }
                this._applyPropertyRenames(elem);
                this._checkUnexpectedFields(elem, type);
                this._processObject(elem, type);
            }
        }
    }
}

export function initArgparse(subparsers) {
    const parser = subparsers.add_parser('schemaorg-normalize-data', {
        add_help: true,
        description: "Normalize schema.org JSON+LD files to match their ThingTalk representation."
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
    parser.add_argument('--class-name', {
        required: false,
        help: 'The name of the device class, used for decide class-specific types',
        default: 'org.schema'
    });
}

export async function execute(args) {
    const normalizer = new Normalizer(args.class_name);
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
