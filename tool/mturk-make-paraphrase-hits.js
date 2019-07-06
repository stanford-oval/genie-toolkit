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

const StreamUtils = require('../lib/stream-utils');
const { NUM_SENTENCES_PER_TASK } = require('./lib/constants');
const { clean } = require('../lib/utils');

class ParaphraseHITCreator extends Stream.Transform {
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
        if (row.context) {
            this._buffer[`context${i}`] = row.context;
            this._buffer[`context_utterance${i}`] = row.context_utterance;
            if (row.assistant_action.startsWith('slot-fill:')) {
                const param = row.assistant_action.split(':')[1];
                this._buffer[`assistant_action${i}`] = `The assistant asks for the value of ${clean(param)} parameter.`;
            } else if (row.assistant_action === 'result') {
                this._buffer[`assistant_action${i}`] = `The assistant shows the result.`;
            } else if (row.assistant_action === 'confirm') {
                this._buffer[`assistant_action${i}`] = `The assistant confirms the command before executing it.`;
            } else {
                throw new Error(`Invalid assistant action ${row.assistant_action}`);
            }
        }
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
        process.stdin
            .pipe(csv.parse({ columns: true, delimiter: '\t' }))
            .pipe(new ParaphraseHITCreator(args.sentences_per_task))
            .pipe(csv.stringify({ header: true, delimiter: ',' }))
            .pipe(args.output);

        return StreamUtils.waitFinish(args.output);
    }
};
