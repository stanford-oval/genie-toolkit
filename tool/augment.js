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

const ThingTalk = require('thingtalk');
const seedrandom = require('seedrandom');
const fs = require('fs');

const FileThingpediaClient = require('./lib/file_thingpedia_client');
const DatasetAugmenter = require('../lib/dataset_augmenter');
const FileParameterProvider = require('./lib/file_parameter_provider');
const { DatasetParser, DatasetStringifier } = require('../lib/dataset-parsers');
const BinaryPPDB = require('../lib/binary_ppdb');

const StreamUtils = require('../lib/stream-utils');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');

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
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'JSON file containing signature, type and mixin definitions.'
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
        const tpClient = new FileThingpediaClient(args.locale, args.thingpedia, args.dataset);
        const schemaRetriever = new ThingTalk.SchemaRetriever(tpClient, null, args.debug);
        const constProvider = new FileParameterProvider(args.parameter_datasets);
        await constProvider.open();

        readAllLines(args.input_file)
            .pipe(new DatasetParser({ contextual: args.contextual }))
            .pipe(new DatasetAugmenter(schemaRetriever, constProvider, tpClient, {
                rng: seedrandom.alea(args.random_seed),
                locale: args.locale,
                debug: args.debug,

                ppdbFile: args.ppdb ? await BinaryPPDB.mapFile(args.ppdb) : null,
                ppdbProbabilitySynthetic: args.ppdb_synthetic_fraction,
                ppdbProbabilityParaphrase: args.ppdb_paraphrase_fraction,
                quotedProbability: args.quoted_fraction,
                untypedStringProbability: args.untyped_string_probability,
                maxSpanLength: args.max_span_length,
                syntheticExpandFactor: args.synthetic_expand_factor,
                paraphrasingExpandFactor: args.quoted_paraphrasing_expand_factor,
                noQuoteExpandFactor: args.no_quote_paraphrasing_expand_factor,
                singleDeviceExpandFactor: args.single_device_expand_factor
            }))
            .pipe(new DatasetStringifier())
            .pipe(args.output);

        await StreamUtils.waitFinish(args.output);
        await constProvider.close();
    }
};
