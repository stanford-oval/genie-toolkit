// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017-2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

process.on('unhandledRejection', (up) => { throw up; });

const path = require('path');
const stream = require('stream');
const seedrandom = require('seedrandom');

const { BasicSentenceGenerator } = require('../lib/sentence-generator');
const DatasetAugmenter = require('../lib/dataset_augmenter');
const Utils = require('../lib/utils');
const FileParameterProvider = require('../tool/lib/file_parameter_provider');

const ThingTalk = require('thingtalk');
const NNSyntax = ThingTalk.NNSyntax;
const SchemaRetriever = ThingTalk.SchemaRetriever;

const _tpClient = require('./mock_schema_delegate');
const _schemaRetriever = new SchemaRetriever(_tpClient, null, true);

async function processOne(id, preprocessed, code) {
    const entities = Utils.makeDummyEntities(preprocessed);

    const program = NNSyntax.fromNN(code.split(' '), entities);
    await program.typecheck(_schemaRetriever);
}

const MAX_SPAN_LENGTH = 10;

async function main() {
    const rng = seedrandom.alea('almond is awesome');
    const generatorOptions = {
        rng,
        locale: 'en-US',
        templateFiles: [path.resolve(path.dirname(module.filename), '../languages/thingtalk/en/thingtalk.genie')],
        targetLanguage: 'thingtalk',
        thingpediaClient: _tpClient,
        flags: {
            turking: false,
            remote_commands: true,
            policies: true,
            aggregation: true,
            bookkeeping: true,
            triple_commands: true,
            undefined_filter: true,
            timer: true,
            projection: true,
            projection_with_filter: true
        },
        maxDepth: 5,
        debug: false
    };

    const augmentOptions = {
        quotedProbability: 0.1,
        untypedStringProbability: 0,
        maxSpanLength: MAX_SPAN_LENGTH,
        ppdbProbabilitySynthetic: 0.1,
        ppdbProbabilityParaphrase: 1.0,
        syntheticExpandFactor: 1,
        paraphrasingExpandFactor: 30,
        noQuoteExpandFactor: 10,

        ppdbFile: {
            // fake ppdb
            get(word) {
                return [];
            }
        },

        locale: 'en-US',
        rng,
        debug: true,
    };

    const generator = new BasicSentenceGenerator(generatorOptions);
    const constProvider = new FileParameterProvider(path.resolve(path.dirname(module.filename), './data/parameter-datasets.tsv'));
    await constProvider.open();
    const augmenter = new DatasetAugmenter(_schemaRetriever, constProvider, _tpClient, augmentOptions);
    const writer = new stream.Writable({
        objectMode: true,

        write(ex, encoding, callback) {
            Promise.resolve().then(() => {
                return processOne(ex.id, ex.preprocessed, ex.target_code);
            }).then(() => {
                callback(null);
            }, (e) => {
                callback(e);
            });
        },

        flush(callback) {
            process.nextTick(callback);
        }
    });
    generator.pipe(augmenter).pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}
module.exports = main;
if (!module.parent)
    main();
