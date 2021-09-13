// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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

import * as argparse from 'argparse';
import * as fs from 'fs';
import Stream from 'stream';
import csvparse from 'csv-parse';
import csvstringify from 'csv-stringify';
import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';

import { ParaphraseValidatorFilter } from '../lib/dataset-tools/mturk/validator';
import { DatasetStringifier } from '../lib/dataset-tools/parsers';
import * as StreamUtils from '../lib/utils/stream-utils';

import * as MT from './lib/mturk-parsers';

import { NUM_SENTENCES_PER_TASK, NUM_PARAPHRASES_PER_SENTENCE, NUM_SUBMISSIONS_PER_TASK } from './lib/constants';

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('mturk-validate', {
        add_help: true,
        description: "Validate the result of MTurk paraphrasing and validation."
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
    parser.add_argument('--timezone', {
        required: false,
        default: undefined,
        help: `Timezone to use to interpret dates and times (defaults to the current timezone).`
    });
    parser.add_argument('--thingpedia', {
        required: true,
        help: 'Path to ThingTalk file containing class definitions.'
    });
    parser.add_argument('--contextual', {
        action: 'store_true',
        help: 'Process a contextual dataset.',
        default: false
    });
    parser.add_argument('--paraphrasing-input', {
        required: true,
        help: 'CSV file containing the output from MTurk paraphrasing.'
    });
    parser.add_argument('--validation-input', {
        required: false,
        help: 'CSV file containing the output from MTurk validation.'
    });
    parser.add_argument('--paraphrasing-rejects', {
        required: false,
        help: 'CSV file in which to write rejections for MTurk paraphrasing.'
    });
    parser.add_argument('--validation-rejects', {
        required: false,
        help: 'CSV file in which to write rejections for MTurk validation.'
    });
    parser.add_argument('--validation-count', {
        required: false,
        type: Number,
        default: NUM_SUBMISSIONS_PER_TASK,
        help: 'Number of workers voting on each paraphrase.'
    });
    parser.add_argument('--validation-threshold', {
        required: true,
        type: Number,
        help: 'Number of workers that must approve of each paraphrase.'
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
    parser.add_argument('--id-prefix', {
        required: false,
        default: '',
        help: "Prefix to the id of each example"
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
}

export async function execute(args : any) {
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
            .pipe(new StreamUtils.MapAccumulator<MT.ValidationCount, 'id'>()).read();
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
            timezone: args.timezone,
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
            timezone: args.timezone,
            debug: args.debug,
            validationCounts,
            validationThreshold: args.validation_threshold
        }))
        .pipe(new Stream.Transform({
            objectMode: true,

            transform(ex, encoding, callback) {
                if (args.contextual) {
                    callback(null, {
                        id: `${args.id_prefix}${ex.id}`,
                        context: ex.context_preprocessed,
                        preprocessed: ex.preprocessed,
                        target_code: ex.target_preprocessed
                    });
                } else {
                    callback(null, {
                        id: `${args.id_prefix}${ex.id}`,
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
