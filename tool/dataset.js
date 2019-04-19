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

//const seedrandom = require('seedrandom');
const fs = require('fs');

const FileThingpediaClient = require('./lib/file_thingpedia_client');
const { ThingTalkDatasetCleaner,
        ThingTalkDatasetPreprocessor,
        ThingTalkDatasetReader,
        ThingTalkDatasetWriter } = require('./thingtalk-dataset')

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
        parser.addArgument('--actions', {
            required: true,
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
        const tpClient = new FileThingpediaClient(args.locale, args.thingpedia, args.input);
        const readerOptions = {
            thingpediaClient: tpClient,
            debug: args.debug
        };
        const writerOptions = {
            outputStream: args.output,
            debug: args.debug
        };

        const reader = new ThingTalkDatasetReader(readerOptions);
        const writer = new ThingTalkDatasetWriter(writerOptions);
        
        let streaming = reader;
        if (args.actions.includes('clean')) {
            const cleanOptions = {
                keepKeys: ['type', 'args', 'value', 'utterances', 'id']
            };
            const cleaner = new ThingTalkDatasetCleaner(cleanOptions);
            streaming = streaming.pipe(cleaner);
        }
        if (args.actions.includes('preprocess')) {
            const preprocessorOptions = {
                locale: args.locale,
                debug: args.debug
            };
            const preprocessor = new ThingTalkDatasetPreprocessor(preprocessorOptions);
            streaming = streaming.pipe(preprocessor);
        }
        streaming = streaming.pipe(writer);
        args.output.on('finish', () => process.exit());
    }
};
