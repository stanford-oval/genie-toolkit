// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 National Taiwan University
//
// Author: Elvis Yu-Jing Lin <r06922068@ntu.edu.tw> <elvisyjlin@gmail.com>
//
// See COPYING for details
"use strict";

const { ThingTalkDataset } = require('./thingtalk-dataset')

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('dataset', {
            addHelp: true,
            description: "Manipulate a dataset. Useful for translating a dataset."
        });
        parser.addArgument(['-i', '--input'], {
            required: true,
            help: 'Path to file containing primitive templates, in ThingTalk syntax.'
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            help: 'Path to output dataset.'
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
        parser.addArgument('--actions', {
            required: false,
            nargs: '*',
            choices: ['clean', 'preprocess'],
            help: 'Action to apply on a dataset.'
        });
        parser.addArgument('--debug', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Enable debugging.',
            defaultValue: true
        });
    },

    async execute(args) {
        const options = {
            debug: true
        };
        const ttDataset = new ThingTalkDataset(options);
        await ttDataset.read(args.locale, args.thingpedia, args.input);
        if (args.actions)
            for (let action of args.actions) {
                if (action == 'clean') {
                    console.log('Cleaning...');
                    const cleanOptions = {
                        keepKeys: ['type', 'args', 'value', 'utterances', 'id']
                    };
                    ttDataset.clean(cleanOptions);
                } else if (action == 'preprocess') {
                    console.log('Preprocessing...');
                    await ttDataset.preprocess();
                } else {
                    throw new Error('Unknown action: ' + action);
                }
            }
        ttDataset.write(args.output, () => process.exit());
    }
};
