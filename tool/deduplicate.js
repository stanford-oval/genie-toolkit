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
const Stream = require('stream');

const { DatasetParser, DatasetStringifier } = require('../lib/dataset-tools/parsers');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');
const StreamUtils = require('../lib/utils/stream-utils');

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('deduplicate', {
            addHelp: true,
            description: "Deduplicate a dataset (remove identical utterances or pairs of context, utterance)."
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument('--contextual', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Process a contextual dataset.',
            defaultValue: false
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input datasets to evaluate (in TSV format); use - for standard input'
        });
    },

    async execute(args) {
        function getDedupeKey(ex) {
            if (args.contextual)
                return ex.context + ' <sep> ' + ex.preprocessed;
            else
                return ex.preprocessed;
        }
        const dedupeMap = new Set;

        readAllLines(args.input_file)
            .pipe(new DatasetParser({ contextual: args.contextual }))
            .pipe(new Stream.Transform({
                objectMode: true,

                transform(ex, encoding, callback) {
                    const key = getDedupeKey(ex);
                    if (!dedupeMap.has(key)) {
                        dedupeMap.add(key);
                        this.push(ex);
                    }
                    callback();
                },

                flush(callback) {
                    process.nextTick(callback);
                }
            }))
            .pipe(new DatasetStringifier())
            .pipe(args.output);

        await StreamUtils.waitFinish(args.output);
    }
};
