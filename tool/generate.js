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

const SentenceGenerator = require('../lib/sentence-generator');

// FIXME
const _tpClient = require('../test/mock_schema_delegate');

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('generate', {
            addHelp: true,
            description: "Generate a new synthetic dataset, given a template file."
        });
        parser.addArgument(['-l', '--language'], {
            required: false,
            defaultValue: 'en',
            help: `2-letter ISO code of natural language to generate (defaults to 'en', English)`
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument('--maxdepth', {
            type: Number,
            defaultValue: 6,
            help: 'Maximum depth of synthetic sentence generation',
        });
        parser.addArgument('--turking', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Restrict grammar rules to MTurk-friendly ones.',
            defaultValue: false
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
    },

    execute(args) {
        const options = {
            rng: seedrandom.alea('almond is awesome'),
            language: 'en',
            targetLanguage: 'thingtalk',
            thingpediaClient: _tpClient,
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
