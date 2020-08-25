// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 National Taiwan University
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
// Author: Elvis Yu-Jing Lin <r06922068@ntu.edu.tw> <elvisyjlin@gmail.com>
"use strict";

const ThingTalkDataset = require('./lib/thingtalk-dataset');

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.add_parser('dataset', {
            add_help: true,
            description: "Manipulate a dataset. Useful for translating a dataset."
        });
        parser.add_argument('-i', '--input', {
            required: true,
            help: 'Path to file containing primitive templates, in ThingTalk syntax.'
        });
        parser.add_argument('-o', '--output', {
            required: true,
            help: 'Path to output dataset.'
        });
        parser.add_argument('-l', '--locale', {
            required: false,
            default: 'en-US',
            help: `BGP 47 locale tag of the language to generate (defaults to 'en-US', English)`
        });
        parser.add_argument('--thingpedia', {
            required: true,
            help: 'Path to JSON file containing signature, type and mixin definitions.'
        });
        parser.add_argument('--actions', {
            required: true,
            nargs: '*',
            choices: ['clean', 'preprocess'],
            help: 'Action to apply on a dataset.',
        });
        parser.add_argument('--debug', {
            action: 'store_true',
            help: 'Enable debugging.',
            default: true
        });
    },

    async execute(args) {
        const options = {
            debug: true
        };
        const ttDataset = new ThingTalkDataset(options);
        await ttDataset.read(args.locale, args.thingpedia, args.input);
        for (let action of args.actions) {
            if (action === 'clean') {
                console.log('Cleaning...');
                const cleanOptions = {
                    keepKeys: ['type', 'args', 'value', 'utterances', 'id']
                };
                ttDataset.clean(cleanOptions);
            } else if (action === 'preprocess') {
                console.log('Preprocessing...');
                await ttDataset.preprocess();
            } else {
                throw new Error('Unknown action: ' + action);
            }
        }
        ttDataset.write(args.output, () => process.exit());
    }
};
