// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//          Mehrad Moradshahi <mehrad@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const fs = require('fs');

const { DatasetParser, DatasetStringifier } = require('../lib/dataset-parsers');
const parallelize = require('../lib/parallelize');
const { AVAILABLE_LANGUAGES } = require('../lib/languages');

const StreamUtils = require('../lib/stream-utils');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');
const ProgressBar = require('./lib/progress_bar');

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('augment', {
            addHelp: true,
            description: "Apply parameter replacement and PPDB augmentation on a Genie dataset."
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
        parser.addArgument(['-pl', '--param-locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the language for parameter values (defaults to 'en-US', English)`
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
        parser.addArgument('--ppdb', {
            required: false,
            help: 'Path to the compiled binary PPDB file',
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

        parser.addArgument('--ppdb-synthetic-fraction', {
            type: Number,
            defaultValue: 0.1,
            metavar: 'FRACTION',
            help: 'Fraction of synthetic sentences to augment with PPDB',
        });
        parser.addArgument('--ppdb-paraphrase-fraction', {
            type: Number,
            defaultValue: 1.0,
            metavar: 'FRACTION',
            help: 'Fraction of paraphrase sentences to augment with PPDB',
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
            dest: 'replace_locations',
            help: 'Do not replace NUMBER tokens',
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
    },

    async execute(args) {
        const inputFile = readAllLines(args.input_file);
        const outputFile = args.output;

        const counter = new StreamUtils.CountStream();

        delete args.input_file;
        delete args.output;
        inputFile
            .pipe(new DatasetParser({ contextual: args.contextual }))
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
