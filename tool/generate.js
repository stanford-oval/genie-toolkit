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

const seedrandom = require('seedrandom');
const fs = require('fs');
const Tp = require('thingpedia');

const { BasicSentenceGenerator } = require('../lib/sentence-generator/batch');
const { DatasetStringifier } = require('../lib/dataset-tools/parsers');
const { AVAILABLE_LANGUAGES } = require('../lib/languages');
const ProgressBar = require('./lib/progress_bar');
const { ActionSetFlag } = require('./lib/argutils');

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('generate', {
            addHelp: true,
            description: "Generate a new synthetic dataset, given a template file."
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
        parser.addArgument(['-t', '--target-language'], {
            required: false,
            defaultValue: 'thingtalk',
            choices: AVAILABLE_LANGUAGES,
            help: `The programming language to generate`
        });
        parser.addArgument('--thingpedia', {
            required: false,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.addArgument('--entities', {
            required: false,
            help: 'Path to JSON file containing entity type definitions.'
        });
        parser.addArgument('--dataset', {
            required: false,
            help: 'Path to file containing primitive templates, in ThingTalk syntax.'
        });
        parser.addArgument('--template', {
            required: true,
            nargs: '+',
            help: 'Path to file containing construct templates, in Genie syntax.'
        });
        parser.addArgument('--set-flag', {
            required: false,
            nargs: 1,
            action: ActionSetFlag,
            constant: true,
            metavar: 'FLAG',
            help: 'Set a flag for the construct template file.',
        });
        parser.addArgument('--unset-flag', {
            required: false,
            nargs: 1,
            action: ActionSetFlag,
            constant: false,
            metavar: 'FLAG',
            help: 'Unset (clear) a flag for the construct template file.',
        });
        parser.addArgument('--maxdepth', {
            required: false,
            type: Number,
            defaultValue: 5,
            help: 'Maximum depth of sentence generation',
        });
        parser.addArgument('--target-pruning-size', {
            required: false,
            type: Number,
            defaultValue: 100000,
            help: 'Approximate target size of the generate dataset, for each $root rule and each depth',
        });
        
        parser.addArgument('--debug', {
            nargs: '?',
            constant: 1,
            defaultValue: 0,
            help: 'Enable debugging. Can be specified with an argument between 0 and 5 to choose the verbosity level.',
        });
        parser.addArgument('--no-debug', {
            nargs: 0,
            constant: 0,
            action: 'storeConst',
            dest: 'debug',
            help: 'Disable debugging.',
        });
        parser.addArgument('--no-progress', {
            nargs: 0,
            action: 'storeFalse',
            dest: 'progress',
            defaultValue: true,
            help: 'Disable the progress bar (implied if --debug is passed).',
        });
        parser.addArgument('--random-seed', {
            defaultValue: 'almond is awesome',
            help: 'Random seed'
        });
        parser.addArgument('--white-list', {
            required: false,
            help: `List of functions to include, split by comma (no space).`
        });
        parser.addArgument('--id-prefix', {
            required: false,
            defaultValue: '',
            help: 'Prefix to add to all sentence IDs (useful to combine multiple datasets).'
        });
    },

    async execute(args) {
        let tpClient = null;
        if (args.thingpedia)
            tpClient = new Tp.FileClient(args);
        const options = {
            rng: seedrandom.alea(args.random_seed),
            locale: args.locale,
            flags: args.flags || {},
            templateFiles: args.template,
            targetLanguage: args.target_language,
            thingpediaClient: tpClient,
            targetPruningSize: args.target_pruning_size,
            maxDepth: args.maxdepth,
            debug: args.debug,
            whiteList: args.white_list,
            idPrefix: args.id_prefix
        };

        const generator = new BasicSentenceGenerator(options);
        generator.pipe(new DatasetStringifier()).pipe(args.output);
        args.output.on('finish', () => process.exit());

        if (!args.debug && args.progress) {
            const progbar = new ProgressBar(1);
            generator.on('progress', (value) => {
                //console.log(value);
                progbar.update(value);
            });

            // issue an update now to show the progress bar
            progbar.update(0);
        }
    }
};
