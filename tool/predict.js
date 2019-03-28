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

const fs = require('fs');
const csv = require('csv');
const byline = require('byline');
const Stream = require('stream');
const ThingTalk = require('thingtalk');

const FileThingpediaClient = require('./lib/file_thingpedia_client');
const { DatasetParser, DatasetStringifier } = require('../lib/dataset-parsers');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');
const ParserClient = require('./lib/parserclient');
const StreamUtils = require('../lib/stream-utils');

class PredictStream extends Stream.Transform {
    constructor(parser, tokenized, debug) {
        super({ objectMode: true });
        
        this._parser = parser;
        this._tokenized = tokenized;
        this._debug = debug;
    }
    
    async _process(ex) {
        const parsed = await this._parser.sendUtterance(ex.preprocessed, this._tokenized);

        const predictions = parsed.candidates
            .filter((beam) => beam.score !== 'Infinity') // ignore exact matches
            .map((beam) => beam.code.join(' '));
        if (predictions.length > 0)
            ex.prediction = predictions[0];
        else
            throw new Error(`no prediction produced for ${ex.id}`);
    }
    
    _transform(ex, encoding, callback) {
        this._process(ex).then(() => callback(null, ex), callback);
    }
    
    _flush(callback) {
        process.nextTick(callback);
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('predict', {
            addHelp: true,
            description: "Compute predictions for Genie-generated dataset."
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument('--url', {
            required: false,
            help: "URL of the server to use. Use a file:// URL pointing to a model directory to predict using a local instance of decanlp",
            defaultValue: 'http://127.0.0.1:8400',
        });
        parser.addArgument('--tokenized', {
            required: false,
            action: 'storeTrue',
            defaultValue: true,
            help: "The dataset is already tokenized (this is the default)."
        });
        parser.addArgument('--no-tokenized', {
            required: false,
            dest: 'tokenized',
            action: 'storeFalse',
            help: "The dataset is not already tokenized."
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input datasets to evaluate (in TSV format); use - for standard input'
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
        const parser = ParserClient.get(args.url, args.locale);
        await parser.start();
    
        readAllLines(args.input_file)
            .pipe(new DatasetParser({ preserveId: true, parseMultiplePrograms: true }))
            .pipe(new PredictStream(parser, args.tokenized, args.debug))
            .pipe(new DatasetStringifier())
            .pipe(args.output);
       
        await StreamUtils.waitFinish(args.output);
        await parser.stop();
    }
};
