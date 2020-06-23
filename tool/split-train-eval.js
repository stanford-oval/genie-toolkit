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
const Stream = require('stream');

const { DatasetParser, DatasetStringifier } = require('../lib/dataset-tools/parsers');
const DatasetSplitter = require('../lib/dataset-tools/splitter');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');
const StreamUtils = require('../lib/utils/stream-utils');
const { coin } = require('../lib/utils/random');

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('split-train-eval', {
            addHelp: true,
            description: "Split a dataset into training and development sets."
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input datasets to augment (in TSV format); use - for standard input'
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the language to generate (defaults to 'en-US', English)`
        });
        parser.addArgument(['--train'], {
            required: true,
            type: fs.createWriteStream,
            help: 'Train file output path',
        });
        parser.addArgument(['--eval'], {
            required: true,
            type: fs.createWriteStream,
            help: 'Eval file output path',
        });
        parser.addArgument(['--test'], {
            required: false,
            type: fs.createWriteStream,
            help: 'Test file output path',
            defaultValue: null
        });
        parser.addArgument(['--eval-probability'], {
            type: Number,
            help: 'Eval probability',
            defaultValue: 0.1,
        });
        parser.addArgument(['--split-strategy'], {
            help: 'Method to use to choose training and evaluation sentences',
            defaultValue: 'sentence',
            choices: DatasetSplitter.SPLIT_STRATEGIES,
        });
        parser.addArgument(['-d', '--device'], {
            action: 'append',
            metavar: 'DEVICE',
            help: 'Filter dataset to commands of the given device. This option can be passed multiple times to specify multiple devices',
            dest: 'forDevices',
        });
        parser.addArgument('--contextual', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Process a contextual dataset.',
            defaultValue: false
        });
        parser.addArgument('--eval-on-synthetic', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Include synthetic data in eval/test.',
            defaultValue: false
        });
        parser.addArgument('--subsample', {
            type: Number,
            help: 'Sample a fraction of the dataset',
            defaultValue: 1.0
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
        parser.addArgument(['--random-seed'], {
            help: 'Random seed',
            defaultValue: 'abcdefghi',
        });
    },

    async execute(args) {
        const promises = [];

        const train = new DatasetStringifier();
        const eval_ = new DatasetStringifier();
        promises.push(StreamUtils.waitFinish(train.pipe(args.train)));
        promises.push(StreamUtils.waitFinish(eval_.pipe(args.eval)));
        let test = null;
        if (args.test) {
            test = new DatasetStringifier();
            promises.push(StreamUtils.waitFinish(test.pipe(args.test)));
        }

        const rng = seedrandom.alea(args.random_seed);
        readAllLines(args.input_file)
            .pipe(new DatasetParser({ contextual: args.contextual }))
            .pipe(new Stream.Transform({
                objectMode: true,

                transform(ex, encoding, callback) {
                    if (args.subsample >= 1 || coin(args.subsample, rng))
                        this.push(ex);
                    callback();
                },

                flush(callback) {
                    process.nextTick(callback);
                }
            }))
            .pipe(new DatasetSplitter({
                rng: rng,
                locale: args.locale,
                debug: args.debug,
                evalOnSynthetic: args.eval_on_synthetic,

                train,
                eval: eval_,
                test,

                evalProbability: args.eval_probability,
                forDevices: args.forDevices,
                splitStrategy: args.split_strategy,
            }));

        return Promise.all(promises);
    }
};
