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
const csvparse = require('csv-parse');
const csvstringify = require('csv-stringify');

const StreamUtils = require('../lib/stream-utils');

class Parser extends Stream.Transform {
    constructor(options) {
        super({
            readableObjectMode: true,
            writableObjectMode: true
        });

        this._sentencesPerTask = options.sentencesPerTask;
        this._idPrefix = options.idPrefix;

        this._id = 0;
    }

    _transform(row, encoding, callback) {
        for (let i = 0; i < this._sentencesPerTask; i++) {
            const sentence = row[`Answer.command-${i+1}`];
            if (!sentence || !sentence.trim())
                continue;

            this.push({
                id: this._idPrefix + String(this._id++),
                utterance: sentence.replace(/\n/g, ' ').replace(/"/g, '')
            });
        }
        callback();
    }

    _flush(callback) {
        process.nextTick(callback);
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('mturk-process-eval-data', {
            addHelp: true,
            description: "Extract the answers of an MTurk task collecting validation/test data."
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument('--sentences-per-task', {
            required: false,
            type: Number,
            defaultValue: 5,
            help: "Number of sentences in each HIT"
        });
        parser.addArgument('--id-prefix', {
            required: false,
            defaultValue: '',
            help: "Prefix for all sentence IDs (to distinguish batches)"
        });
        parser.addArgument('input_file', {
            nargs: '+',
            help: 'MTurk result file to choose contexts from, split'
        });
    },

    async execute(args) {
        const inputs = args.input_file.map((file) => {
            return fs.createReadStream(file, { encoding: 'utf8' })
                .pipe(csvparse({ columns: true, delimiter: ',', relax_column_count: true }));
        });

        await StreamUtils.waitFinish(StreamUtils.chain(inputs, { objectMode: true })
            .pipe(new Parser({ sentencesPerTask: args.sentences_per_task, idPrefix: args.id_prefix }))
            .pipe(csvstringify({ header: true, delimiter: '\t' }))
            .pipe(args.output));
    }
};
