// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const ThingTalk = require('thingtalk');

const FileThingpediaClient = require('./lib/file_thingpedia_client');
const DialogParser = require('./lib/dialog_parser');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');
const ParserClient = require('./lib/parserclient');
const { DialogEvaluatorStream, CollectDialogStatistics } = require('./lib/evaluators');

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('evaluate-dialog', {
            addHelp: true,
            description: "Evaluate a trained model on a dialog data, by contacting a running Genie server."
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
        parser.addArgument('--csv', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Output a single CSV line',
        });
    },

    async execute(args) {
        const tpClient = new FileThingpediaClient(args);
        const schemas = new ThingTalk.SchemaRetriever(tpClient, null, true);
        const parser = ParserClient.get(args.url, args.locale);
        await parser.start();

        const output = readAllLines(args.input_file, '====')
            .pipe(new DialogParser())
            .pipe(new DialogEvaluatorStream(parser, schemas, args.tokenized, args.debug))
            .pipe(new CollectDialogStatistics());

        const result = await output.read();

        let buffer = '';
        for (let key of ['total', 'turns', 'ok', 'ok_initial', 'ok_partial', 'ok_progress']) {
            if (buffer)
                buffer += ',';
            buffer += String(result[key]);
        }
        console.log(buffer);

        await parser.stop();
    }
};
