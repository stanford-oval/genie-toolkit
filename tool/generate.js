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
const stream = require('stream');
const argparse = require('argparse');

const FileThingpediaClient = require('./lib/file_thingpedia_client');
const SentenceGenerator = require('../lib/sentence-generator');

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
        const parser = subparsers.addParser('generate', {
            addHelp: true,
            description: "Generate a new synthetic dataset, given a template file."
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument(['-l', '--language'], {
            required: false,
            defaultValue: 'en',
            help: `2-letter ISO code of natural language to generate (defaults to 'en', English)`
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to JSON file containing signature, type and mixin definitions.'
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
            defaultValue: 6,
            help: 'Maximum depth of sentence generation',
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
        const tpClient = new FileThingpediaClient(args.language, args.thingpedia, args.dataset);
        const options = {
            rng: seedrandom.alea(args.random_seed),
            language: args.language,
            flags: args.flags || {},
            templateFile: args.template,
            thingpediaClient: tpClient,
            turkingMode: args.turking,
            maxDepth: args.maxdepth,
            debug: args.debug
        };

        const generator = new SentenceGenerator(options);
        const transform = new stream.Transform({
            writableObjectMode: true,

            transform(ex, encoding, callback) {
                callback(null, 'S' + ex.id + '\t' + ex.utterance + '\t' + ex.target_code + '\n');
            },

            flush(callback) {
                process.nextTick(callback);
            }
        });

        generator.pipe(transform).pipe(args.output);
        args.output.on('finish', () => process.exit());
    }
};
