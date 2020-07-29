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
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
"use strict";

const Tp = require('thingpedia');
const ThingTalk = require('thingtalk');
const fs = require('fs');

const { DatasetParser } = require('../lib/dataset-tools/parsers');
const { SentenceEvaluatorStream, CollectSentenceStatistics } = require('../lib/dataset-tools/evaluation/sentence_evaluator');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');
const ParserClient = require('../lib/prediction/parserclient');

function csvDisplay(args, complexity, result, device, with_numeric=false, without_numeric=false) {
    let buffer = '';
    if (args.csv_prefix)
        buffer = args.csv_prefix + ',';

    if (args.split_by_device)
        buffer += device + ',';

    let prefix = '';
    if (with_numeric) {
        prefix = `with_numeric_`;
        if (!result[`${prefix}total`])
            return;

        buffer += `with_numeric,` + String(result[`${prefix}total`]);
    } else if (without_numeric) {
        prefix = `without_numeric_`;
        if (!result[`${prefix}total`])
            return;

        buffer += `without_numeric,` + String(result[`${prefix}total`]);
    } else if (complexity === null) {
        buffer += 'all,';
        buffer += String(result.total);
    } else {
        prefix = `complexity_${complexity}/`;
        if (!result[`${prefix}total`])
            return;

        buffer += String(complexity) + ',' + String(result[`${prefix}total`]);
    }
    for (let key of ['ok', 'ok_without_param', 'ok_function', 'ok_device', 'ok_num_function', 'ok_syntax']) {
        const fullkey = `${prefix}${key}`;
        result[fullkey].length = parseInt(process.env.CSV_LENGTH || 1);
        buffer += ',';
        buffer += String(result[fullkey]);
    }

    args.output.write(buffer + '\n');
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('evaluate-server', {
            addHelp: true,
            description: "Evaluate a trained model on a Genie-generated dataset, by contacting a running Genie server."
        });
        parser.addArgument(['-o', '--output'], {
            required: false,
            defaultValue: process.stdout,
            type: fs.createWriteStream,
            description: "Write results to this file instead of stdout"
        });
        parser.addArgument('--url', {
            required: false,
            help: "URL of the server to evaluate. Use a file:// URL pointing to a model directory to evaluate using a local instance of decanlp",
            defaultValue: 'http://127.0.0.1:8400',
        });
        parser.addArgument('--tokenized', {
            required: false,
            action: 'storeTrue',
            defaultValue: true,
            help: "The dataset is already tokenized (this is the default)."
        });
        parser.addArgument('--no-tokenized', {
            required: false,
            dest: 'tokenized',
            action: 'storeFalse',
            help: "The dataset is not already tokenized."
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.addArgument('--contextual', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Process a contextual dataset.',
            defaultValue: false
        });
        parser.addArgument('--split-by-device', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Compute evaluation statistics separating examples by Thingpedia device',
            defaultValue: false
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input datasets to evaluate (in TSV format); use - for standard input'
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the language to evaluate (defaults to 'en-US', English)`
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
        parser.addArgument('--csv', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Output a single CSV line',
        });
        parser.addArgument('--csv-prefix', {
            required: false,
            defaultValue: '',
            help: `Prefix all output lines with this string`
        });
        parser.addArgument('--complexity-metric', {
            choices: ['num_params', 'turn_number'],
            defaultValue: 'num_params',
            help: `Complexity metric to use to divide examples by complexity`
        });
        parser.addArgument('--max-complexity', {
            required: false,
            type: Number,
            defaultValue: '',
            help: 'Collapse all examples of complexity greater or equal to this',
        });
    },

    async execute(args) {
        const tpClient = new Tp.FileClient(args);
        const schemas = new ThingTalk.SchemaRetriever(tpClient, null, true);
        const parser = ParserClient.get(args.url, args.locale);
        await parser.start();

        const output = readAllLines(args.input_file)
            .pipe(new DatasetParser({ contextual: args.contextual, preserveId: true, parseMultiplePrograms: true }))
            .pipe(new SentenceEvaluatorStream(args.locale, parser, schemas, args.tokenized, args.debug, args.complexity_metric))
            .pipe(new CollectSentenceStatistics({ maxComplexity: args.max_complexity ,
                                                  splitByDevice: args.split_by_device}));

        const result = await output.read();

        const devices = Object.keys(result);
        devices.sort((d1, d2) => {
            // sort 'generic' first, then alphabetical
            // sadly, 'g' > '@'
            if (d1 === d2)
                return 0;
            if (d1 === 'generic')
                return -1;
            if (d2 === 'generic')
                return 1;
            if (d1 < d2)
                return -1;
            else
                return 1;
        });

        for (let device of devices) {
            if (args.csv) {
                csvDisplay(args, null, result[device], device);
                if (args.max_complexity) {
                    for (let complexity = 0; complexity < args.max_complexity; complexity++)
                        csvDisplay(args, complexity, result[device], device);
                    csvDisplay(args, '>=' + args.max_complexity, result[device], device);
                } else {
                    for (let complexity = 0; complexity < 10; complexity++)
                        csvDisplay(args, complexity, result);
                }
                csvDisplay(args, null, result, device, true);
                csvDisplay(args, null, result, device, false, true);
            } else {
                for (let key in result[device]) {
                    if (Array.isArray(result[device][key]))
                        args.output.write(`${device + ', ' + key} = [${result[device][key].join(', ')}]\n`);
                    else
                        args.output.write(`${device + ', ' + key} = ${result[device][key]}\n`);
                }
            }
        }
        args.output.end();

        await parser.stop();
    }
};
