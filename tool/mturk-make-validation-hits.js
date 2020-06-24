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
const csvparse = require('csv-parse');
const csvstringify = require('csv-stringify');
const seedrandom = require('seedrandom');
const Tp = require('thingpedia');
const ThingTalk = require('thingtalk');

const { ParaphraseValidatorFilter } = require('../lib/dataset-tools/mturk/validator');
const ValidationHITCreator = require('../lib/dataset-tools/mturk/paraphrase-validation');
const TokenizerService = require('../lib/tokenizer');
const { ArrayAccumulator, ArrayStream, waitFinish } = require('../lib/utils/stream-utils');

const { ParaphrasingParser, ParaphrasingAccumulator } = require('./lib/mturk-parsers');
const { NUM_SENTENCES_PER_TASK, NUM_PARAPHRASES_PER_SENTENCE, NUM_SUBMISSIONS_PER_TASK } = require('./lib/constants');

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
            help: 'Path to ThingTalk file containing class definitions.'
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
        const tpClient = new Tp.FileClient(args);
        const schemaRetriever = new ThingTalk.SchemaRetriever(tpClient, null, !args.debug);
        const tokenizer = TokenizerService.get(process.env.GENIE_USE_TOKENIZER, true);
        const rng = seedrandom.alea(args.random_seed);

        process.stdin.setEncoding('utf8');

        // read all paraphrases, auto-validate them, then accumulate them in memory
        // so we can sample a fake one to choose

        const accumulator = new ArrayAccumulator();
        process.stdin.pipe(csvparse({
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
            .pipe(csvstringify({ header: true, delimiter: ',' }))
            .pipe(args.output);

        await waitFinish(args.output);

        tokenizer.end();
    }
};
