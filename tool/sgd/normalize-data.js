// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Silei Xu <silei@cs.stanford.edu>
//
// See COPYING for details
"use strict";


const assert = require('assert');
const fs = require('fs');
const util = require('util');
const ThingTalk = require('thingtalk');
const crypto = require('crypto');

const StreamUtils = require('../../lib/stream-utils');
const { makeMetadata } = require('../lib/metadata');
const { cleanEnumValue } = require('./utils');

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

function parseMeasure(str) {
    const match = /^(-?(?:(?:0|[1-9][0-9]*)\.[0-9]*(?:[eE][+-]?[0-9]+)?|\.[0-9]+(?:[eE][+-]?[0-9]+)?|(?:0|[1-9][0-9]*)(?:[eE][+-]?[0-9]+)?))\s+([a-zA-Z]+)$/.exec(str);
    if (!match) {
        console.error(`Invalid measurement value ${str}`);
        return undefined;
    }

    let [, value, unit] = match;

    try {
        ThingTalk.Units.normalizeUnit(unit);
    } catch (e) {
        console.error(`Invalid measurement unit ${unit}`);
        return undefined;
    }

    return ThingTalk.Units.transformToBaseUnit(parseFloat(value), unit);
}

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
        const library = ThingTalk.Grammar.parse(await util.promisify(fs.readFile)(thingpedia, { encoding: 'utf8' }));
        assert(library.isLibrary && library.classes.length === 1);
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
                    return {value: num, code: currency.toLowerCase()};
                }
                return {value: parseFloat(value), code: 'usd'};
            } else if (expectedType.type === 'tt:Number') {
                return parseFloat(value);
            } else if (expectedType.type === 'tt:Duration') {
                return parseDuration(value);
            } else if (expectedType.type === 'tt:Measure') {
                return parseMeasure(value);
            } else if (expectedType.type.startsWith('tt:Enum(')) {
                const enumerands = expectedType.type.substring('tt:Enum('.length, expectedType.type.length - 1).split(/,/g);
                value = cleanEnumValue(value);
                if (value === undefined)
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
                    if (!(fname in this.output))
                        this.output[fname] = {};

                    for (let result of frame.service_results)
                        this._processResult(fname, result);
                }
            }
        }
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('sgd-normalize-data', {
            addHelp: true,
            description: "Generate normalized data from dialogs to match their ThingTalk representation."
        });
        parser.addArgument('--data-output', {
            type: fs.createWriteStream
        });
        parser.addArgument('--meta-output', {
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

        if (args.meta_output) {
            args.meta_output.end(JSON.stringify(normalizer.meta, undefined, 2));
            await StreamUtils.waitFinish(args.meta_output);
        }

        if (args.data_output) {
            args.data_output.end(JSON.stringify(normalizer.output, undefined, 2));
            await StreamUtils.waitFinish(args.data_output);
        }
    }
};
