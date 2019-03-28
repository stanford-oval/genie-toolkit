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
const DatasetSplitter = require('../lib/dataset_splitter');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');
const StreamUtils = require('../lib/stream-utils');

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

        readAllLines(args.input_file)
            .pipe(new DatasetParser())
            .pipe(new DatasetSplitter({
                rng: seedrandom.alea(args.random_seed),
                locale: args.locale,
                debug: args.debug,

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
