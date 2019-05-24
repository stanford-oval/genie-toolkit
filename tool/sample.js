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
const byline = require('byline');
const csv = require('csv');

const { DatasetParser } = require('../lib/dataset-parsers');
const SentenceSampler = require('../lib/sampler');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');
const { parseConstantFile } = require('./lib/constant-file');


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
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input datasets to augment (in TSV format); use - for standard input'
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

        readAllLines(args.input_file)
            .pipe(new DatasetParser({ preserveId: true }))
            .pipe(new SentenceSampler(constants, options))
            .pipe(csv.stringify({ header: true, delimiter: '\t' }))
            .pipe(args.output);

        return new Promise((resolve, reject) => {
            args.output.on('finish', resolve);
            args.output.on('error', reject);
        });
    }
};
