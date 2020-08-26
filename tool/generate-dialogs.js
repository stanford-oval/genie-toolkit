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
const JSONStream = require('JSONStream');
const Tp = require('thingpedia');
const seedrandom = require('seedrandom');

const { AVAILABLE_LANGUAGES } = require('../lib/languages');
const { DialogueGenerator } = require('../lib/sentence-generator/batch');
const StreamUtils = require('../lib/utils/stream-utils');
const { DialogueSerializer } = require('../lib/dataset-tools/parsers');

const { ActionSetFlag } = require('./lib/argutils');

const DIALOG_SERIALIZERS = {
    json() {
        return JSONStream.stringify(undefined, undefined, undefined, 2);
    },

    txt() {
        return new DialogueSerializer();
    },

    txt_only() {
        return new DialogueSerializer({ annotations: false });
    }
};

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.add_parser('generate-dialogs', {
            add_help: true,
            description: "Generate a new synthetic dialog dataset, given a template file."
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
        parser.add_argument('-f', '--output-format', {
            required: false,
            default: 'txt-only',
            choices: ['json', 'txt', 'txt-only'],
            help: `Output format`
        });
        parser.add_argument('--max-turns', {
            required: false,
            default: 7,
            type: Number,
            help: `Maximum number of turns per dialog`
        });
        parser.add_argument('-t', '--target-language', {
            required: false,
            default: 'thingtalk',
            choices: AVAILABLE_LANGUAGES,
            help: `The programming language to generate`
        });
        parser.add_argument('--thingpedia', {
            required: false,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.add_argument('--entities', {
            required: false,
            help: 'Path to JSON file containing entity type definitions.'
        });
        parser.add_argument('--dataset', {
            required: false,
            help: 'Path to file containing primitive templates, in ThingTalk syntax.'
        });
        parser.add_argument('--template', {
            required: true,
            nargs: '+',
            help: 'Path to file containing construct templates, in Genie syntax.'
        });
        parser.add_argument('--set-flag', {
            required: false,
            nargs: 1,
            action: ActionSetFlag,
            const: true,
            metavar: 'FLAG',
            help: 'Set a flag for the construct template file.',
        });
        parser.add_argument('--unset-flag', {
            required: false,
            nargs: 1,
            action: ActionSetFlag,
            const: false,
            metavar: 'FLAG',
            help: 'Unset (clear) a flag for the construct template file.',
        });
        parser.add_argument('--maxdepth', {
            required: false,
            type: Number,
            default: 4,
            help: 'Maximum depth of sentence generation',
        });
        parser.add_argument('--target-pruning-size', {
            required: false,
            type: Number,
            default: 100,
            help: 'Pruning target for each non-terminal',
        });
        parser.add_argument('-B', '--minibatch-size', {
            required: false,
            type: Number,
            default: 1000,
            help: 'Number of partial dialogue to keep in the working set for each minibatch',
        });
        parser.add_argument('-n', '--num-minibatches', {
            required: false,
            default: 1,
            type: Number,
            help: `Number of minibatches of dialogues to generate`
        });

        parser.add_argument('--debug', {
            nargs: '?',
            const: 1,
            default: 0,
            help: 'Enable debugging. Can be specified with an argument between 0 and 5 to choose the verbosity level.',
        });
        parser.add_argument('--no-debug', {
            const: 0,
            action: 'store_const',
            dest: 'debug',
            help: 'Disable debugging.',
        });
        parser.add_argument('--random-seed', {
            default: 'almond is awesome',
            help: 'Random seed'
        });
    },

    async execute(args) {
        let tpClient = null;
        if (args.thingpedia)
            tpClient = new Tp.FileClient(args);
        const options = {
            rng: seedrandom.alea(args.random_seed),
            locale: args.locale,
            flags: args.flags || {},
            templateFiles: args.template,
            targetLanguage: args.target_language,
            thingpediaClient: tpClient,
            maxDepth: args.maxdepth,
            targetPruningSize: args.target_pruning_size,
            maxTurns: args.max_turns,
            minibatchSize: args.minibatch_size,
            numMinibatches: args.num_minibatches,

            debug: args.debug,
        };
        new DialogueGenerator(options)
            .pipe(DIALOG_SERIALIZERS[args.output_format.replace('-', '_')]())
            .pipe(args.output);

        await StreamUtils.waitFinish(args.output);
    }
};
