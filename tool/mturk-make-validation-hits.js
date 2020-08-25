// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Silei Xu <silei@cs.stanford.edu>
//         Giovanni Campagna <gcampagn@cs.stanford.edu>
"use strict";

const fs = require('fs');
const csvparse = require('csv-parse');
const csvstringify = require('csv-stringify');
const seedrandom = require('seedrandom');
const Tp = require('thingpedia');
const ThingTalk = require('thingtalk');

const { ParaphraseValidatorFilter } = require('../lib/dataset-tools/mturk/validator');
const ValidationHITCreator = require('../lib/dataset-tools/mturk/paraphrase-validation');
const { ArrayAccumulator, ArrayStream, waitFinish } = require('../lib/utils/stream-utils');

const { ParaphrasingParser, ParaphrasingAccumulator } = require('./lib/mturk-parsers');
const { NUM_SENTENCES_PER_TASK, NUM_PARAPHRASES_PER_SENTENCE, NUM_SUBMISSIONS_PER_TASK } = require('./lib/constants');

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.add_parser('mturk-make-validation-hits', {
            add_help: true,
            description: "Prepare the input file for the manual validation HITs."
        });
        parser.add_argument('-o', '--output', {
            required: true,
            type: fs.createWriteStream
        });
        parser.add_argument('-l', '--locale', {
            required: false,
            default: 'en-US',
            help: `BGP 47 locale tag of the language to generate (defaults to 'en-US', English)`
        });
        parser.add_argument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.add_argument('--sentences-per-task', {
            required: false,
            type: Number,
            default: NUM_SENTENCES_PER_TASK,
            help: "Number of sentences in each HIT"
        });
        parser.add_argument('--submissions-per-task', {
            required: false,
            type: Number,
            default: NUM_SUBMISSIONS_PER_TASK,
            help: "Number of submissions (workers) for each HIT"
        });
        parser.add_argument('--paraphrases-per-sentence', {
            required: false,
            type: Number,
            default: NUM_PARAPHRASES_PER_SENTENCE,
            help: "Number of paraphrases collected for each sentence"
        });
        parser.add_argument('--debug', {
            action: 'store_true',
            help: 'Enable debugging.',
            default: true
        });
        parser.add_argument('--no-debug', {
            action: 'store_false',
            dest: 'debug',
            help: 'Disable debugging.',
        });
        parser.add_argument('--random-seed', {
            default: 'almond is awesome',
            help: 'Random seed'
        });
    },

    async execute(args) {
        const tpClient = new Tp.FileClient(args);
        const schemaRetriever = new ThingTalk.SchemaRetriever(tpClient, null, !args.debug);
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
            .pipe(new ParaphraseValidatorFilter(schemaRetriever, {
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
    }
};
