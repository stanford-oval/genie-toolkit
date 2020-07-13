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
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
"use strict";

const fs = require('fs');
const Stream = require('stream');
const csvparse = require('csv-parse');
const csvstringify = require('csv-stringify');
const Tp = require('thingpedia');
const ThingTalk = require('thingtalk');

const { ParaphraseValidatorFilter } = require('../lib/dataset-tools/mturk/validator');
const { DatasetStringifier } = require('../lib/dataset-tools/parsers');
const StreamUtils = require('../lib/utils/stream-utils');

const MT = require('./lib/mturk-parsers');

const { NUM_SENTENCES_PER_TASK, NUM_PARAPHRASES_PER_SENTENCE, NUM_SUBMISSIONS_PER_TASK } = require('./lib/constants');

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('mturk-validate', {
            addHelp: true,
            description: "Validate the result of MTurk paraphrasing and validation."
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
        parser.addArgument('--contextual', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Process a contextual dataset.',
            defaultValue: false
        });
        parser.addArgument('--paraphrasing-input', {
            required: true,
            help: 'CSV file containing the output from MTurk paraphrasing.'
        });
        parser.addArgument('--validation-input', {
            required: false,
            help: 'CSV file containing the output from MTurk validation.'
        });
        parser.addArgument('--paraphrasing-rejects', {
            required: false,
            help: 'CSV file in which to write rejections for MTurk paraphrasing.'
        });
        parser.addArgument('--validation-rejects', {
            required: false,
            help: 'CSV file in which to write rejections for MTurk validation.'
        });
        parser.addArgument('--validation-count', {
            required: false,
            type: Number,
            defaultValue: NUM_SUBMISSIONS_PER_TASK,
            help: 'Number of workers voting on each paraphrase.'
        });
        parser.addArgument('--validation-threshold', {
            required: true,
            type: Number,
            help: 'Number of workers that must approve of each paraphrase.'
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
        const tpClient = new Tp.FileClient(args);
        const schemaRetriever = new ThingTalk.SchemaRetriever(tpClient, null, !args.debug);

        let validationRejects = Promise.resolve();
        let validationCounts;

        if (args.validation_threshold > 0) {
            if (!args.validation_input)
                throw new Error(`Argument --validation-input is required when performing manual validation`);
            const validationInput = fs.createReadStream(args.validation_input)
                .pipe(csvparse({
                    columns: true,
                    delimiter: ',',
                    relax_column_count: true
                }))
                .pipe(new MT.ValidationRejecter({
                    sentencesPerTask: args.sentences_per_task
                }));

            if (args.validation_rejects) {
                validationRejects = StreamUtils.waitFinish(validationInput
                    .pipe(csvstringify({ header: true, delimiter: ',' }))
                    .pipe(fs.createWriteStream(args.validation_rejects)));
            }

            validationCounts = await validationInput
                .pipe(new MT.ValidationParser({
                    sentencesPerTask: args.sentences_per_task,
                    targetSize: args.paraphrases_per_sentence * args.submissions_per_task,
                    skipRejected: true
                }))
                .pipe(new MT.ValidationCounter({
                    targetNumVotes: args.validation_count
                }))
                .pipe(new StreamUtils.MapAccumulator()).read();
        }

        const rejectedPara = fs.createReadStream(args.paraphrasing_input)
            .pipe(csvparse({
                columns: true,
                delimiter: ',',
                relax_column_count: true
            }))
            .pipe(new MT.ParaphrasingRejecter(schemaRetriever, {
                sentencesPerTask: args.sentences_per_task,
                paraphrasesPerSentence: args.paraphrases_per_sentence,
                locale: args.locale,
                contextual: args.contextual
            }));

        let paraphrasingRejects;
        if (args.paraphrasing_rejects) {
            paraphrasingRejects = StreamUtils.waitFinish(rejectedPara
                .pipe(csvstringify({ header: true, delimiter: ',' }))
                .pipe(fs.createWriteStream(args.paraphrasing_rejects)));
        } else {
            paraphrasingRejects = Promise.resolve();
        }

        rejectedPara
            .pipe(new MT.ParaphrasingParser({
                sentencesPerTask: args.sentences_per_task,
                paraphrasesPerSentence: args.paraphrases_per_sentence,
                contextual: args.contextual,
                skipRejected: true
            }))
            .pipe(new ParaphraseValidatorFilter(schemaRetriever, {
                locale: args.locale,
                debug: args.debug,
                validationCounts,
                validationThreshold: args.validation_threshold
            }))
            .pipe(new Stream.Transform({
                objectMode: true,

                transform(ex, encoding, callback) {
                    if (args.contextual) {
                        callback(null, {
                            id: ex.id,
                            context: ex.context_preprocessed,
                            preprocessed: ex.preprocessed,
                            target_code: ex.target_preprocessed
                        });
                    } else {
                        callback(null, {
                            id: ex.id,
                            preprocessed: ex.preprocessed,
                            target_code: ex.target_preprocessed
                        });
                    }
                },

                flush(callback) {
                    callback();
                }
            }))
            .pipe(new DatasetStringifier())
            .pipe(args.output);

        await Promise.all([
            StreamUtils.waitFinish(args.output),
            validationRejects,
            paraphrasingRejects
        ]);
    }
};
