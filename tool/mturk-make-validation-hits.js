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
const ThingTalk = require('thingtalk');

const ParaphraseValidator = require('../lib/validator');

const FileThingpediaClient = require('./lib/file_thingpedia_client');
const TokenizerService = require('./lib/tokenizer_service');
const { ParaphrasingParser, ParaphrasingAccumulator } = require('./lib/mturk-parsers');

const NUM_SENTENCES_PER_TASK = 4;
const NUM_PARAPHRASES_PER_SENTENCE = 2;
const NUM_SUBMISSIONS_PER_TASK = 3;

class Transformer extends Stream.Transform {
    constructor(options) {
        super({
            readableObjectMode: true,
            writableObjectMode: true,
        });

        this._i = 0;
        this._buffer = {};

        this._debug = options.debug;
        this._targetSize = options.targetSize;
        this._sentencesPerTask = options.sentencesPerTask;
    }

    _transform(row, encoding, callback) {
        if (row.paraphrases.length < this._targetSize) {
            if (this._debug)
                console.log(`Skipped synthetic sentence ${row.synthetic_id}: not enough paraphrases`);
            callback();
            return;
        }

        const i = ++this._i;
        this._buffer[`synthetic_id${i}`] = row.synthetic_id;
        this._buffer[`thingtalk${i}`] = row.target_code;
        this._buffer[`sentence${i}`] = row.utterance;

        for (let j = 0; j < row.paraphrases.length; j++) {
            let {id, paraphrase} = row.paraphrases[j];
            this._buffer[`id${i}-${j+1}`] = id;
            this._buffer[`paraphrase${i}-${j+1}`] = paraphrase;
        }

        if (i === this._sentencesPerTask) {
            this.push(this._buffer);
            this._i = 0;
            this._buffer = {};
        }
        callback();
    }

    _flush(callback) {
        process.nextTick(callback);
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('mturk-make-validation-hits', {
            addHelp: true,
            description: "Prepare the input file for the manual validation HITs."
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the language to generate (defaults to 'en-US', English)`
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to JSON file containing signature, type and mixin definitions.'
        });
        parser.addArgument('--sentences-per-task', {
            required: false,
            type: Number,
            defaultValue: NUM_SENTENCES_PER_TASK,
            help: "Number of sentences in each HIT"
        });
        parser.addArgument('--submissions-per-task', {
            required: false,
            type: Number,
            defaultValue: NUM_SUBMISSIONS_PER_TASK,
            help: "Number of submissions (workers) for each HIT"
        });
        parser.addArgument('--paraphrases-per-sentence', {
            required: false,
            type: Number,
            defaultValue: NUM_PARAPHRASES_PER_SENTENCE,
            help: "Number of paraphrases collected for each sentence"
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

    async execute(args) {
        const tpClient = new FileThingpediaClient(args.locale, args.thingpedia, args.dataset);
        const schemaRetriever = new ThingTalk.SchemaRetriever(tpClient, null, args.debug);
        const tokenizer = TokenizerService.get();

        process.stdin.setEncoding('utf8');

        process.stdin.pipe(csv.parse({
            columns: true,
            delimiter: ',',
            relax_column_count: true
            }))
            .pipe(new ParaphrasingParser({
                sentencesPerTask: args.sentences_per_task,
                paraphrasesPerSentence: args.paraphrases_per_sentence
            }))
            .pipe(new ParaphraseValidator(schemaRetriever, tokenizer, {
                locale: args.locale,
                debug: args.debug
            }))
            .pipe(new ParaphrasingAccumulator(args.paraphrases_per_sentence * args.submissions_per_task))
            .pipe(new Transformer({
                debug: args.debug,
                targetSize: args.paraphrases_per_sentence * args.submissions_per_task,
                sentencesPerTask: args.sentences_per_task,
            }))
            .pipe(csv.stringify({ header: true, delimiter: ',' }))
            .pipe(args.output);

        await new Promise((resolve, reject) => {
            args.output.on('finish', resolve);
            args.output.on('error', reject);
        });

        tokenizer.end();
    }
};
