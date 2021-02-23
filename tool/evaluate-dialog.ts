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

import * as argparse from 'argparse';
import * as fs from 'fs';

import { KEYS, DialogueEvaluatorStream, CollectDialogueStatistics } from '../lib/dataset-tools/evaluation/dialogue_evaluator';
import { DialogueParser } from '../lib/dataset-tools/parsers';
import { maybeCreateReadStream, readAllLines } from './lib/argutils';
import * as ParserClient from '../lib/prediction/parserclient';
import MultiJSONDatabase from './lib/multi_json_database';
import FileThingpediaClient from './lib/file_thingpedia_client';

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('evaluate-dialog', {
        add_help: true,
        description: "Evaluate a trained model on a dialog data, by contacting a running Genie server."
    });
    parser.add_argument('-o', '--output', {
        required: false,
        default: process.stdout,
        type: fs.createWriteStream,
        help: "Write results to this file instead of stdout"
    });
    parser.add_argument('--url', {
        required: false,
        help: "URL of the server to evaluate. Use a file:// URL pointing to a model directory to evaluate using a local instance of genienlp",
        default: 'http://127.0.0.1:8400',
    });
    parser.add_argument('--tokenized', {
        required: false,
        action: 'store_true',
        default: false,
        help: "The dataset is already tokenized."
    });
    parser.add_argument('--no-tokenized', {
        required: false,
        dest: 'tokenized',
        action: 'store_false',
        help: "The dataset is not already tokenized (this is the default)."
    });
    parser.add_argument('--thingpedia', {
        required: true,
        help: 'Path to ThingTalk file containing class definitions.'
    });
    parser.add_argument('input_file', {
        nargs: '+',
        type: maybeCreateReadStream,
        help: 'Input datasets to evaluate (in dialog format); use - for standard input'
    });
    parser.add_argument('-l', '--locale', {
        required: false,
        default: 'en-US',
        help: `BGP 47 locale tag of the language to evaluate (defaults to 'en-US', English)`
    });
    parser.add_argument('-t', '--target-language', {
        required: false,
        default: 'thingtalk',
        choices: ['thingtalk', 'dlgthingtalk'],
        help: `The programming language to generate`
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
    parser.add_argument('--database-file', {
        required: false,
        help: `Path to a file pointing to JSON databases used to simulate queries.`,
    });
    parser.add_argument('--parameter-datasets', {
        required: true,
        help: 'TSV file containing the paths to datasets for strings and entity types.'
    });
    parser.add_argument('--csv', {
        action: 'store_true',
        help: 'Output a single CSV line',
    });
    parser.add_argument('--csv-prefix', {
        required: false,
        default: '',
        help: `Prefix all output lines with this string`
    });
    parser.add_argument('--oracle', {
        action: 'store_true',
        help: 'Indicates evaluation of an oracle model where ThingTalk code should be passed to the genienlp server',
        default: false
    });
}

export async function execute(args : any) {
    let tpClient : FileThingpediaClient|null = null;
    if (args.thingpedia)
        tpClient = new FileThingpediaClient(args);
    const parser = ParserClient.get(args.url, args.locale);
    await parser.start();

    let database;
    if (args.database_file) {
        database = new MultiJSONDatabase(args.database_file);
        await database.load();
    }

    const output = readAllLines(args.input_file, '====')
        .pipe(new DialogueParser())
        .pipe(new DialogueEvaluatorStream(parser, {
            locale: args.locale,
            targetLanguage: args.target_language,
            thingpediaClient: tpClient,
            tokenized: args.tokenized,
            debug: args.debug,
            database: database,
            oracle: args.oracle
        }))
        .pipe(new CollectDialogueStatistics());

    const result = await output.read();

    let buffer = '';
    if (args.csv_prefix)
        buffer = args.csv_prefix + ',';
    let first = true;
    for (const key of ['total', 'turns'].concat(KEYS)) {
        if (!first)
            buffer += ',';
        first = false;
        buffer += String(result[key]);
    }
    buffer += '\n';
    args.output.write(buffer);
    args.output.end();

    await parser.stop();
}
