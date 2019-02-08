// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2018-2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Silei Xu <silei@cs.stanford.edu>
//         Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const fs = require('fs');
const Stream = require('stream');
const csv = require('csv');
const seedrandom = require('seedrandom');
const shuffle = require('shuffle-array');
const ThingTalk = require('thingtalk');

const { ParaphraseValidatorFilter } = require('../lib/validator');

const FileThingpediaClient = require('./lib/file_thingpedia_client');
const TokenizerService = require('./lib/tokenizer_service');
const { ParaphrasingParser, ParaphrasingAccumulator } = require('./lib/mturk-parsers');
const { ArrayAccumulator, ArrayStream, waitFinish } = require('./lib/stream-utils');

const { NUM_SENTENCES_PER_TASK, NUM_PARAPHRASES_PER_SENTENCE, NUM_SUBMISSIONS_PER_TASK } = require('./lib/constants');

function quickGetFunctions(code) {
    const devices = [];
    const functions = [];

    const regex = /@([a-z0-9_.]+)([a-z0-9_]+)\(/g;

    let match = regex.exec(code);
    while (match !== null) {
        devices.push(match[1]);
        functions.push(match[2]);
        match = regex.exec(code);
    }
    return [devices, functions];
}

function subset(array1, array2) {
    for (let el of array1) {
        if (array2.indexOf(el) < 0)
            return false;
    }
    return true;
}

// generate a fake parphrase with same device(s) but different functions
function fakeParaphrase(batch, targetCode) {
    const [devices, functions] = quickGetFunctions(targetCode);

    for (let candidate of batch) {
        const [candDevices, candFunctions] = quickGetFunctions(candidate.target_code);

        if (subset(devices, candDevices) && !subset(functions, candFunctions))
            return candidate.paraphrase;
    }

    // return something
    return 'if reddit front page updated, get a #dog gif';
}

class ValidationHITCreator extends Stream.Transform {
    constructor(batch, options) {
        super({
            readableObjectMode: true,
            writableObjectMode: true,
        });

        this._batch = batch;

        this._i = 0;
        this._buffer = {};

        this._debug = options.debug;
        this._targetSize = options.targetSize;
        this._sentencesPerTask = options.sentencesPerTask;
        this._rng = options.rng;
    }

    _transform(row, encoding, callback) {
        if (row.paraphrases.length < this._targetSize) {
            if (this._debug)
                console.log(`Skipped synthetic sentence ${row.synthetic_id}: not enough paraphrases`);
            callback();
            return;
        }

        const i = ++this._i;
        this._buffer[`id${i}`] = row.synthetic_id;
        this._buffer[`thingtalk${i}`] = row.target_code;
        this._buffer[`sentence${i}`] = row.synthetic;

        const fakeSame = row.synthetic;
        const fakeDifferent = fakeParaphrase(this._batch, row.target_code);
        const paraphrases = [{
            id: '-same',
            paraphrase: fakeSame
        }, {
            id: '-different',
            paraphrase: fakeDifferent,
        }].concat(row.paraphrases);

        shuffle(paraphrases, { rng: this._rng });
        this._buffer[`index_same${i}`] = 1 + paraphrases.findIndex((el) => el.id === '-same');
        this._buffer[`index_diff${i}`] = 1 + paraphrases.findIndex((el) => el.id === '-different');

        for (let j = 0; j < paraphrases.length; j++) {
            let {id, paraphrase} = paraphrases[j];
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
        parser.addArgument('--random-seed', {
            defaultValue: 'almond is awesome',
            help: 'Random seed'
        });
    },

    async execute(args) {
        const tpClient = new FileThingpediaClient(args.locale, args.thingpedia, args.dataset);
        const schemaRetriever = new ThingTalk.SchemaRetriever(tpClient, null, args.debug);
        const tokenizer = TokenizerService.get();
        const rng = seedrandom.alea(args.random_seed);

        process.stdin.setEncoding('utf8');

        // read all paraphrases, auto-validate them, then accumulate them in memory
        // so we can sample a fake one to choose

        const accumulator = new ArrayAccumulator();
        process.stdin.pipe(csv.parse({
                columns: true,
                delimiter: ',',
                relax_column_count: true
            }))
            .pipe(new ParaphrasingParser({
                sentencesPerTask: args.sentences_per_task,
                paraphrasesPerSentence: args.paraphrases_per_sentence
            }))
            .pipe(new ParaphraseValidatorFilter(schemaRetriever, tokenizer, {
                locale: args.locale,
                debug: args.debug
            }))
            .pipe(accumulator);

        const batch = await accumulator.read();

        (new ArrayStream(batch, { objectMode: true }))
            .pipe(new ParaphrasingAccumulator(args.paraphrases_per_sentence * args.submissions_per_task))
            .pipe(new ValidationHITCreator(batch, {
                targetSize: args.paraphrases_per_sentence * args.submissions_per_task,
                sentencesPerTask: args.sentences_per_task,
                debug: args.debug,
                rng: rng
            }))
            .pipe(csv.stringify({ header: true, delimiter: ',' }))
            .pipe(args.output);

        await waitFinish(args.output);

        tokenizer.end();
    }
};
