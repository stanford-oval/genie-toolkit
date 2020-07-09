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
