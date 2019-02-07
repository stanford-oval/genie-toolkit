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

const seedrandom = require('seedrandom');
const fs = require('fs');
const assert = require('assert');
const byline = require('byline');
const Stream = require('stream');
const csv = require('csv');

const SentenceSampler = require('../lib/sampler');

function parseMeasure(valueString) {
    const match = /^(-?(?:[0-9]+(?:\.[0-9]*)?(?:e[0-9]+)?|\.[0-9]+(?:e[0-9]+)?))([A-Za-z_][A-Za-z0-9_]*)/.exec(valueString);
    if (match === null)
        throw new Error(`Invalid measure syntax: ${valueString}`);
    const value = Number(match[1]);
    const unit = match[2];
    return [value, unit];
}

function parseConstant(locale, type, valueString, display) {
    switch (type) {
    case 'Number':
        return {
            key: valueString,
            value: Number(valueString),
            display: display || (Number(valueString).toLocaleString(locale))
        };
    case 'String':
        return {
            key: valueString,
            // lower-case the string to match what almond-tokenizer does, or the program
            // will be inconsistent
            value: valueString.toLowerCase(),
            display: `“${valueString}”`
        };
    case 'Currency': {
        const [value, unit] = parseMeasure(valueString);
        return {
            key: valueString,
            value: { value, unit },
            display: display || value.toLocaleString(locale, { style: 'currency', currency: unit.toUpperCase() })
        };
    }
    case 'Location': {
        const [lat, lon] = valueString.split(',');
        if (!display)
            throw new Error(`display field is required for Location constant`);
        return {
            key: valueString,
            value: {
                latitude: Number(lat),
                longitude: Number(lon),
                display
            },
            display
        };
    }
    case 'Date': {
        const date = new Date(valueString);
        return {
            key: valueString,
            value: date,
            display: display || date.toLocaleString(locale)
        };
    }
    case 'Time': {
        let [hour, minute, second] = valueString.split(':');
        hour = parseInt(hour, 10);
        minute = parseInt(minute, 10);
        second = parseInt(second, 10) || 0;
        return {
            key: valueString,
            value: { hour, minute, second },
            display: display || valueString
        };
    }
    case 'Entity(tt:email_address)':
    case 'Entity(tt:phone_number)':
    case 'Entity(tt:url)':
    case 'Entity(tt:path_name)':
        return {
            key: valueString,
            value: valueString,
            display: display || valueString
        };
    case 'Entity(tt:hashtag)':
        return {
            key: '#' + valueString,
            value: valueString,
            display: display || '#' + valueString
        };
    case 'Entity(tt:username)':
        return {
            key: '@' + valueString,
            value: valueString,
            display: display || '@' + valueString
        };
    }


    if (type.startsWith('Measure(')) {
        const [value, unit] = parseMeasure(valueString);
        assert(!Number.isNaN(value));
        return {
            key: valueString,
            value,
            unit,
            display: display || `${value.toLocaleString(locale)} ${unit}`
        };
    } else if (type.startsWith('Entity(')) {
        if (!display)
            throw new Error(`display field is required for constant of type ${type}`);
        return {
            key: valueString,
            value: {
                value: valueString,
                display
            },
            display
        };
    } else {
        throw new Error(`Invalid constant type ${type}`);
    }
}

function parseConstantFile(locale, filename) {
    const file = fs.createReadStream(filename);
    file.setEncoding('utf8');
    const input = byline(file);

    const constants = {};
    input.on('data', (line) => {
        if (/^\s*(#|$)/.test(line))
            return;

        const [key, value, display] = line.trim().split('\t');

        let type;
        if (key.startsWith('param:@')) {
            const match = /^param:@[^:]+:[^:]+:(.+)$/.exec(key);
            if (match === null)
                throw new Error(`Invalid syntax: ${key}`);
            type = match[1];
        } else if (key.startsWith('param:')) {
            const match = /^param:[^:]+:(.+)$/.exec(key);
            if (match === null)
                throw new Error(`Invalid syntax: ${key}`);
            type = match[1];
        } else {
            type = key;
        }

        if (!constants[key])
            constants[key] = [];
        constants[key].push(parseConstant(locale, type, value, display));
    });

    return new Promise((resolve, reject) => {
        input.on('end', () => resolve(constants));
        input.on('error', reject);
    });
}

function parseSamplingControlFile(filename) {
    const functionBlackList = new Set;
    const deviceBlackList = new Set;
    const functionHighValueList = new Set;
    let functionWhiteList;
    let deviceWhiteList;

    if (!filename)
        return Promise.resolve([functionBlackList, deviceBlackList, functionHighValueList, functionWhiteList, deviceWhiteList]);

    const file = fs.createReadStream(filename);
    file.setEncoding('utf8');
    const input = byline(file);


    input.on('data', (line) => {
        if (/^\s*(#|$)/.test(line))
            return;

        const [attribute, functionName] = line.trim().split('\t');

        switch (attribute) {
        case 'whitelist':
            if (functionName.endsWith('.*')) {
                if (!deviceWhiteList)
                    deviceWhiteList = new Set;
                deviceWhiteList.add(functionName);
            } else {
                if (!functionWhiteList)
                    functionWhiteList = new Set;
                functionWhiteList.add(functionName);
            }
            break;
        case 'blacklist':
            if (functionName.endsWith('.*'))
                deviceBlackList.add(functionName);
            else
                functionBlackList.add(functionName);
            break;
        case 'high':
            // ignore high value whole devices
            if (!functionName.endsWith('.*'))
                functionHighValueList.add(functionName);
            break;
        case 'low':
            // ignore low value entry (everything is low-value by default)
            break;
        default:
            throw new Error(`Invalid function attribute ${attribute}`);
        }
    });

    return new Promise((resolve, reject) => {
        input.on('end', () => resolve([functionBlackList, deviceBlackList, functionHighValueList, functionWhiteList, deviceWhiteList]));
        input.on('error', reject);
    });
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('sample', {
            addHelp: true,
            description: "Choose which sentences to paraphrase, given a synthetic set."
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument('--constants', {
            required: true,
            help: 'TSV file containing constant values to use.'
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the natural language being processed (defaults to en-US).`
        });
        parser.addArgument('--sampling-strategy', {
            required: false,
            choices: ['byCode', 'bySignature'],
            help: 'Which sampling strategy to use (defaults: bySignature).'
        });
        parser.addArgument('--sampling-control', {
            required: false,
            help: 'TSV file controlling sampling based on functions in the programs. Defaults to treating all functions equally.'
        });
        parser.addArgument('--compound-only', {
            help: 'Keep only compound programs. (False if omitted)',
            action: 'storeTrue'
        });

        parser.addArgument('--debug', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Enable debugging.',
            defaultValue: true
        });
        parser.addArgument('--no-debug', {
            nargs: 0,
            action: 'storeFalse',
            dest: 'debug',
            help: 'Disable debugging.',
        });
        parser.addArgument('--random-seed', {
            defaultValue: 'almond is awesome',
            help: 'Random seed'
        });
    },

    async execute(args) {
        const constants = await parseConstantFile(args.locale, args.constants);
        const [functionBlackList, deviceBlackList, functionHighValueList, functionWhiteList, deviceWhiteList] =
            await parseSamplingControlFile(args.sampling_control);

        const options = {
            rng: seedrandom.alea(args.random_seed),
            locale: args.locale,

            samplingStrategy: args.sampling_strategy,
            functionBlackList,
            deviceBlackList,
            functionHighValueList,
            functionWhiteList,
            deviceWhiteList,

            compoundOnly: !!args.compound_only,
            debug: args.debug
        };

        process.stdin.setEncoding('utf8');
        const input = byline(process.stdin);
        const inputtransform = new Stream.Transform({
            readableObjectMode: true,
            writableObjectMode: true,

            transform(line, encoding, callback) {
                const [id, utterance, target_code] = line.trim().split('\t');
                callback(null, { id, utterance, target_code });
            },

            flush(callback) {
                process.nextTick(callback);
            }
        });
        const sampler = new SentenceSampler(constants, options);
        const output = csv.stringify({ header: true, delimiter: '\t' });
        input.pipe(inputtransform).pipe(sampler).pipe(output).pipe(args.output);

        return new Promise((resolve, reject) => {
            args.output.on('finish', resolve);
            args.output.on('error', reject);
        });
    }
};
