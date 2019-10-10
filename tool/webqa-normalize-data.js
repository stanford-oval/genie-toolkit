// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

// Parse a .jsonld file and normalize it based on how we expect schema.org to look like

const assert = require('assert');
const fs = require('fs');
const util = require('util');
//const assert = require('assert');
const ThingTalk = require('thingtalk');
const uuid = require('uuid');
const deq = require('deep-equal');

const StreamUtils = require('../lib/stream-utils');
const { makeMetadata } = require('./lib/webqa-metadata');

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

    if (!ThingTalk.Units.UnitsToBaseUnit[unit]) {
        console.error(`Invalid measurement unit ${unit}`);
        return undefined;
    }

    return ThingTalk.Units.transformToBaseUnit(parseFloat(value), unit);
}

// maps old name to new name
const PROPERTY_RENAMES = {
    'checkInTime': 'checkinTime',
    'checkOutTime': 'checkoutTime',
    'AggregateRating': 'aggregateRating',
    'awards': 'award',

    // clean up property ambiguity by consolidating to one property
    'reviewBody': 'description',
};

function ensureArray(value) {
    if (Array.isArray(value))
        return value;
    else
        return [value];
}

class Normalizer {
    constructor() {
        // metadata for each schema.org type
        this._meta = {};

        // the normalized file
        this.output = {};

        // deduplicate according to sameAs
        this._sameAsMap = new Map;

        // deduplication of warnings
        this._warnings = new Set;
    }

    async init(thingpedia) {
        const library = ThingTalk.Grammar.parse(await util.promisify(fs.readFile)(thingpedia, { encoding: 'utf8' }));
        assert(library.isLibrary && library.classes.length === 1 && library.classes[0].kind === 'org.schema');
        const classDef = library.classes[0];
        this._classDef = classDef;

        for (let fn in classDef.queries) {
            const fndef = classDef.queries[fn];
            this._meta[fn] = {
                extends: fndef.extends,
                fields: makeMetadata(fndef.args.map((argname) => fndef.getArgument(argname)))
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
            if (field === '@id' || field === '@type' || field === '@context' || field === 'sameAs')
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
        const typemeta = this._meta[type];
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
            if (type !== 'Review' && type !== 'Person') { // but now for review or person, there are too many and it's slow
                for (let candidateId in this.output[type]) {
                    const candidate = this.output[type][candidateId];
                    // ignore the ID in comparison
                    candidate['@id'] = undefined;
                    const good = deq(candidate, value, { strict: true });
                    candidate['@id'] = candidateId;
                    if (good)
                        return candidateId;
                }
            }

            // nope, make up a new object
            value['@id'] = 'https://thingpedia.stanford.edu/ns/uuid/' + type + '/' + uuid.v4();
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

    _processField(value, path, expectedType) {
        if (value === null || value === undefined) {
            if (expectedType.isArray)
                return [];
            else
                return undefined;
        }

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
                const newValue = this._processField(value[i], path, innerExpected);
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

                    if (expectedType.type === 'tt:String' &&
                        value['@type'] === 'HowToStep' &&
                        value.text)
                        return String(value.text);

                    console.error(`Unexpected object in ${path.join('.')}, expected a ${expectedType.type}`);
                    console.error(value);


                    return undefined;
                }

                if (expectedType.type === 'tt:Number') {
                    return parseFloat(value);
                } else if (expectedType.type === 'tt:Duration') {
                    return parseDuration(value);
                } else if (expectedType.type === 'tt:Measure') {
                    return parseMeasure(value);
                } else if (expectedType.type.startsWith('tt:Enum(')) {
                    const enumerands = expectedType.type.substring('tt:Enum('.length, expectedType.type.length-1).split(/,/g);
                    if (!enumerands.includes(value)) {
                        console.error(`Expected enumerated value in ${path.join('.')}, got`, value);
                        return undefined;
                    }
                    return value;
                } else {
                    return String(value);
                }
            } else {
                if (typeof value === 'object') {
                    let nestedtype = value['@type'];
                    if (!nestedtype) {
                        //console.error(`Nested object has no @type in ${path.join('.')}, assuming ${expectedType.type}`);

                        // add a type and hope for the best
                        nestedtype = value['@type'] = expectedType.type;
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
                value[field] = this._processField(value[field], path, expectedType.type[field]);
                path.pop();
            }

            return value;
        }
    }

    async process(filename) {
        console.error('filename', filename);
        let input = JSON.parse(await util.promisify(fs.readFile)(filename), { encoding: 'utf8' });


        if (!Array.isArray(input))
            input = [input];

        for (let value of input) {
            const type = value['@type'];
            if (!type) {
                console.error(`Top-level object has no @type`, value);
                continue;
            }
            this._applyPropertyRenames(value);
            this._checkUnexpectedFields(value, type);
            this._processObject(value, type);
        }
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('webqa-normalize-data', {
            addHelp: true,
            description: "Normalize schema.org JSON+LD files to match their ThingTalk representation."
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.addArgument('input_file', {
            nargs: '+',
            help: 'Input JSON+LD files to normalize. Multiple input files will be merged in one.'
        });
    },

    async execute(args) {
        const normalizer = new Normalizer();
        await normalizer.init(args.thingpedia);
        for (let filename of args.input_file)
            await normalizer.process(filename);

        args.output.end(JSON.stringify(normalizer.output, undefined, 2));
        await StreamUtils.waitFinish(args.output);
    }
};
