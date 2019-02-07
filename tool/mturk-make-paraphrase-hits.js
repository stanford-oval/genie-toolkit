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
const csv = require('csv');

const NUM_SENTENCES_PER_TASK = 4;

class Transformer extends Stream.Transform {
    constructor(sentencesPerTask) {
        super({
            readableObjectMode: true,
            writableObjectMode: true,
        });

        this._sentencesPerTask = sentencesPerTask;
        this._i = 0;
        this._buffer = {};
    }

    _transform(row, encoding, callback) {
        const i = ++this._i;
        this._buffer[`id${i}`] = row.id;
        this._buffer[`thingtalk${i}`] = row.target_code;
        this._buffer[`sentence${i}`] = row.utterance;

        if (i === this._sentencesPerTask) {
            callback(null, this._buffer);
            this._i = 0;
            this._buffer = {};
        } else {
            callback();
        }
    }

    _flush(callback) {
        process.nextTick(callback);
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('mturk-make-paraphrase-hits', {
            addHelp: true,
            description: "Prepare the input file for the manual paraphrase HITs."
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument('--sentences-per-task', {
            required: false,
            type: Number,
            defaultValue: NUM_SENTENCES_PER_TASK,
            help: "Number of sentences in each HIT"
        });
    },

    async execute(args) {
        process.stdin.setEncoding('utf8');
        const input = csv.parse({ columns: true, delimiter: '\t' });
        const transform = new Transformer(args.sentences_per_task);
        const output = csv.stringify({ header: true, delimiter: ',' });
        process.stdin.pipe(input).pipe(transform).pipe(output).pipe(args.output);

        return new Promise((resolve, reject) => {
            args.output.on('finish', resolve);
            args.output.on('error', reject);
        });
    }
};
