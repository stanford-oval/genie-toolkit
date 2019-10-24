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

const fs = require('fs');
const argparse = require('argparse');

const { DatasetStringifier } = require('../lib/dataset-parsers');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');
const parallelize = require('../lib/parallelize');
const StreamUtils = require('../lib/stream-utils');

class ActionSetFlag extends argparse.Action {
    call(parser, namespace, values) {
        if (!namespace.flags)
            namespace.set('flags', {});
        for (let value of values)
            namespace.flags[value] = this.constant;
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('generate-contextual', {
            addHelp: true,
            description: "Generate a new contextual synthetic dataset, given a template file."
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Context files to choose contexts from'
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the language to generate (defaults to 'en-US', English)`
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.addArgument('--entities', {
            required: true,
            help: 'Path to JSON file containing entity type definitions.'
        });
        parser.addArgument('--dataset', {
            required: true,
            help: 'Path to file containing primitive templates, in ThingTalk syntax.'
        });
        parser.addArgument('--template', {
            required: true,
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
            defaultValue: 4,
            help: 'Maximum depth of sentence generation',
        });
        parser.addArgument('--target-pruning-size', {
            required: false,
            type: Number,
            defaultValue: 10000,
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

        delete args.input_file;
        delete args.output;
        inputFile
            .pipe(await parallelize(args.parallelize, require.resolve('./workers/generate-contextual-worker.js'), args))
            .pipe(new DatasetStringifier())
            .pipe(outputFile);
        await StreamUtils.waitFinish(outputFile);
    }
};
