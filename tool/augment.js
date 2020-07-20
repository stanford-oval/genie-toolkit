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
//          Mehrad Moradshahi <mehrad@cs.stanford.edu>
"use strict";

const fs = require('fs');

const { DatasetParser, DatasetStringifier } = require('../lib/dataset-tools/parsers');
const parallelize = require('../lib/utils/parallelize');
const { AVAILABLE_LANGUAGES } = require('../lib/languages');

const StreamUtils = require('../lib/utils/stream-utils');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');
const ProgressBar = require('./lib/progress_bar');

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('augment', {
            addHelp: true,
            description: "Apply parameter replacement and misc augmentations on a Genie dataset."
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the language to generate (defaults to 'en-US', English)`
        });
        parser.addArgument(['--param-locale'], {
            required: false,
            help: `BGP 47 locale tag of the language for parameter values (defaults to the same value as --locale)`
        });
        parser.addArgument(['-t', '--target-language'], {
            required: false,
            defaultValue: 'thingtalk',
            choices: AVAILABLE_LANGUAGES,
            help: `The programming language to generate`
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.addArgument('--parameter-datasets', {
            required: true,
            help: 'TSV file containing the paths to datasets for strings and entity types.'
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input datasets to augment (in TSV format); use - for standard input'
        });
        parser.addArgument('--contextual', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Process a contextual dataset.',
            defaultValue: false
        });
        parser.addArgument('--quoted-fraction', {
            type: Number,
            defaultValue: 0.1,
            metavar: 'FRACTION',
            help: 'Fraction of sentences that will not have their quoted parameters replaced',
        });
        parser.addArgument('--untyped-string-probability', {
            type: Number,
            defaultValue: 0.0,
            metavar: 'FRACTION',
            help: 'Fraction of sentences that will have generic text in their string parameters'
        });
        parser.addArgument('--max-span-length', {
            type: Number,
            defaultValue: 10,
            metavar: 'LENGTH',
            help: 'Maximum length of a string parameter (in words)'
        });
        parser.addArgument('--synthetic-expand-factor', {
            type: Number,
            defaultValue: 5,
            metavar: 'FACTOR',
            help: 'Expansion factor of synthetic sentences (including augmented synthetic)'
        });
        parser.addArgument('--quoted-paraphrasing-expand-factor', {
            type: Number,
            defaultValue: 30,
            metavar: 'FACTOR',
            help: 'Expansion factor of paraphrased sentences with quoted parameters'
        });
        parser.addArgument('--no-quote-paraphrasing-expand-factor', {
            type: Number,
            defaultValue: 10,
            metavar: 'FACTOR',
            help: 'Expansion factor of paraphrased sentences without quoted parameters)'
        });
        parser.addArgument('--single-device-expand-factor', {
            type: Number,
            defaultValue: 5,
            metavar: 'FACTOR',
            help: 'Number of sentences to generate with "ask" or "tell" prefixes for single-device commands'
        });
        parser.addArgument('--replace-locations', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Replace LOCATION tokens with unquoted locations.',
            defaultValue: true
        });
        parser.addArgument('--no-replace-locations', {
            nargs: 0,
            action: 'storeFalse',
            dest: 'replace_locations',
            help: 'Do not replace LOCATION tokens with unquoted locations.',
        });
        parser.addArgument('--replace-numbers', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Replace NUMBER tokens with actual values.',
            defaultValue: false
        });
        parser.addArgument('--no-replace-numbers', {
            nargs: 0,
            action: 'storeFalse',
            dest: 'replace_numbers',
            help: 'Do not replace NUMBER tokens',
        });
        parser.addArgument('--requotable', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Replace parameters in a way that they can be requoted later (defaults to true).',
            defaultValue: true
        });
        parser.addArgument('--no-requotable', {
            nargs: 0,
            action: 'storeFalse',
            dest: 'requotable',
            help: 'Allow the replacement of a parameter in the sentence and in the program to differ (making requoting impossible).',
        });
        parser.addArgument('--clean-parameters', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Take extra effort to use parameters that are simple and do not include punctuation marks',
            defaultValue: false
        });
        parser.addArgument('--sampling-type', {
            choices: ['default', 'random'],
            help: 'Random strategy assigns random weights to parameters instead of reading from file',
            defaultValue: false
        });
        parser.addArgument('--num-attempts', {
            type: Number,
            defaultValue: 10000,
            help: 'Maximum number of attempts to replace a parameter value'
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
        parser.addArgument('--parallelize', {
            type: Number,
            help: 'Run N threads in parallel (requires --experimental-worker support)',
            metavar: 'N',
            defaultValue: 1,
        });
        parser.addArgument('--override-flags', {
            required: false,
            defaultValue: '',
            help: 'Override input sentence flags with the provided flag(s)'
        });
    },

    async execute(args) {
        const inputFile = readAllLines(args.input_file);
        const outputFile = args.output;
        if (!args.param_locale)
            args.param_locale = args.locale;

        const counter = new StreamUtils.CountStream();

        delete args.input_file;
        delete args.output;
        inputFile
            .pipe(new DatasetParser({ contextual: args.contextual, overrideFlags: args.override_flags }))
            .pipe(counter)
            .pipe(await parallelize(args.parallelize, require.resolve('./workers/augment-worker'), args))
            .pipe(new DatasetStringifier())
            .pipe(outputFile);

        if (!args.debug) {
            const progbar = new ProgressBar(1);
            counter.on('progress', (value) => {
                //console.log(value);
                progbar.update(value);
            });

            // issue an update now to show the progress bar
            progbar.update(0);
        }

        await StreamUtils.waitFinish(outputFile);
    }
};
