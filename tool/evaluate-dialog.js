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

const { AVAILABLE_LANGUAGES } = require('../lib/languages');
const { KEYS, DialogueEvaluatorStream, CollectDialogueStatistics } = require('../lib/dataset-tools/evaluation/dialogue_evaluator');
const { DialogueParser } = require('../lib/dataset-tools/parsers');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');
const ParserClient = require('../lib/prediction/parserclient');
const MultiJSONDatabase = require('./lib/multi_json_database');
const FileThingpediaClient = require('./lib/file_thingpedia_client');

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('evaluate-dialog', {
            addHelp: true,
            description: "Evaluate a trained model on a dialog data, by contacting a running Genie server."
        });
        parser.addArgument(['-o', '--output'], {
            required: false,
            defaultValue: process.stdout,
            type: fs.createWriteStream,
            description: "Write results to this file instead of stdout"
        });
        parser.addArgument('--url', {
            required: false,
            help: "URL of the server to evaluate. Use a file:// URL pointing to a model directory to evaluate using a local instance of decanlp",
            defaultValue: 'http://127.0.0.1:8400',
        });
        parser.addArgument('--tokenized', {
            required: false,
            action: 'storeTrue',
            defaultValue: false,
            help: "The dataset is already tokenized."
        });
        parser.addArgument('--no-tokenized', {
            required: false,
            dest: 'tokenized',
            action: 'storeFalse',
            help: "The dataset is not already tokenized (this is the default)."
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input datasets to evaluate (in dialog format); use - for standard input'
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the language to evaluate (defaults to 'en-US', English)`
        });
        parser.addArgument(['-t', '--target-language'], {
            required: false,
            defaultValue: 'thingtalk',
            choices: AVAILABLE_LANGUAGES,
            help: `The programming language to generate`
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
        parser.addArgument('--database-file', {
            required: false,
            help: `Path to a file pointing to JSON databases used to simulate queries.`,
        });
        parser.addArgument('--parameter-datasets', {
            required: true,
            help: 'TSV file containing the paths to datasets for strings and entity types.'
        });
        parser.addArgument('--csv', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Output a single CSV line',
        });
        parser.addArgument('--csv-prefix', {
            required: false,
            defaultValue: '',
            help: `Prefix all output lines with this string`
        });
    },

    async execute(args) {
        let tpClient = null;
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
                database: database
            }))
            .pipe(new CollectDialogueStatistics());

        const result = await output.read();

        let buffer = '';
        if (args.csv_prefix)
            buffer = args.csv_prefix + ',';
        let first = true;
        for (let key of ['total', 'turns'].concat(KEYS)) {
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
};
