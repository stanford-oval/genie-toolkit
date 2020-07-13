// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
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

process.on('unhandledRejection', (up) => { throw up; });

const path = require('path');
const stream = require('stream');
const seedrandom = require('seedrandom');

const { BasicSentenceGenerator } = require('../../lib/sentence-generator/batch');
const DatasetAugmenter = require('../../lib/dataset-tools/augmentation');
const Utils = require('../../lib/utils/misc-utils');
const FileParameterProvider = require('../../tool/lib/file_parameter_provider');

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
        templateFiles: [path.resolve(path.dirname(module.filename), '../../languages/thingtalk/en/thingtalk.genie')],
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
        targetPruningSize: 100,
        debug: false
    };

    const augmentOptions = {
        quotedProbability: 0.1,
        untypedStringProbability: 0,
        maxSpanLength: MAX_SPAN_LENGTH,
        syntheticExpandFactor: 1,
        paraphrasingExpandFactor: 30,
        noQuoteExpandFactor: 10,

        locale: 'en-US',
        paramLocale: 'en',
        rng,
        debug: true,
    };

    const generator = new BasicSentenceGenerator(generatorOptions);
    const constProvider = new FileParameterProvider(path.resolve(path.dirname(module.filename), '../data/en-US/parameter-datasets.tsv'), 'en');
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
