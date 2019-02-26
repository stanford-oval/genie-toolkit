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
const { DatasetParser } = require('../lib/dataset-parsers');
const { SentenceEvaluatorStream, CollectStatistics } = require('./lib/evaluators');
const StreamUtils = require('./lib/stream-utils');

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('evaluate-file', {
            addHelp: true,
            description: "Evaluate a trained model on a Genie-generated dataset, using a pre-generated prediction file."
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to JSON file containing signature, type and mixin definitions.'
        });
        parser.addArgument('--dataset', {
            required: true,
            type: fs.createReadStream,
            help: 'Input dataset to evaluate (in TSV format)'
        });
        parser.addArgument('--predictions', {
            required: true,
            type: fs.createReadStream,
            help: 'Prediction results (in TSV format: id, prediction)'
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
    },

    async execute(args) {
        const tpClient = new FileThingpediaClient(args.locale, args.thingpedia);
        const schemas = new ThingTalk.SchemaRetriever(tpClient, null, true);

        const predictionstream = args.predictions
            .pipe(csv.parse({ columns: ['id', 'prediction'], delimiter: '\t', relax: true }))
            .pipe(new StreamUtils.MapAccumulator());
        const predictions = await predictionstream.read();

        const output = args.dataset
            .setEncoding('utf8')
            .pipe(byline())
            .pipe(new DatasetParser())
            .pipe(new Stream.Transform({
                objectMode: true,

                transform(ex, encoding, callback) {
                    const prediction = predictions.get(ex.id);
                    if (!prediction)
                        throw new Error(`missing prediction for sentence ${ex.id}`);

                    ex.predictions = [prediction.prediction.split(' ')];
                    callback(null, ex);
                },

                flush(callback) {
                    process.nextTick(callback);
                }
            }))
            .pipe(new SentenceEvaluatorStream(null, schemas, true, args.debug))
            .pipe(new CollectStatistics());

        const result = await output.read();
        for (let key in result) {
            if (Array.isArray(result[key]))
                console.log(`${key} = [${result[key].join(', ')}]`);
            else
                console.log(`${key} = ${result[key]}`);
        }
    }
};
