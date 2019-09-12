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

const { DatasetParser, DatasetStringifier } = require('../lib/dataset-parsers');
const Contextualizer = require('../lib/contextualizer');

const StreamUtils = require('../lib/stream-utils');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('contextualize', {
            addHelp: true,
            description: "Transform a non-contextual dataset to a contextual one."
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
        parser.addArgument(['-c', '--context'], {
            required: true,
            action: 'append',
            type: fs.createReadStream,
            help: `Context files to use`,
        });
        parser.addArgument(['--expansion-factor'], {
            type: Number,
            help: `Number of contexts per input sentence`,
            defaultValue: 20
        });
        parser.addArgument('--null-only', {
            action: 'storeTrue',
            help: 'Use only the null context. If set, --expansion-factor is ignored.',
            defaultValue: false
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input datasets to contextualize (in TSV format); use - for standard input'
        });
        parser.addArgument('--random-seed', {
            defaultValue: 'almond is awesome',
            help: 'Random seed'
        });
    },

    async execute(args) {
        const rng = seedrandom.alea(args.random_seed);

        let allprograms = await readAllLines(args.context)
            .pipe(new StreamUtils.ArrayAccumulator())
            .read();

        await StreamUtils.waitFinish(
            readAllLines(args.input_file)
            .pipe(new DatasetParser({ parseMultiplePrograms: args.null_only, preserveId: true }))
            .pipe(new Contextualizer(allprograms, {
                locale: args.locale,
                numSamples: args.expansion_factor,
                nullOnly: args.null_only,

                rng
            }))
            .pipe(new DatasetStringifier())
            .pipe(args.output)
        );
    }
};
