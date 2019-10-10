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

        this._id = 0;
    }

    _transform(row, encoding, callback) {
        for (let i = 0; i < this._sentencesPerTask; i++) {
            const sentence = row[`Answer.command-${i+1}`];
            if (!sentence || !sentence.trim())
                continue;

            this.push({
                id: this._id++,
                utterance: sentence
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
        parser.addArgument('input_file', {
            help: 'MTurk result file to choose contexts from'
        });
    },

    async execute(args) {
        await StreamUtils.waitFinish(fs.createReadStream(args.input_file, { encoding: 'utf8' })
            .pipe(csvparse({ columns: true, delimiter: ',', relax_column_count: true }))
            .pipe(new Parser({ sentencesPerTask: args.sentences_per_task }))
            .pipe(csvstringify({ header: true, delimiter: '\t' }))
            .pipe(args.output));
    }
};
