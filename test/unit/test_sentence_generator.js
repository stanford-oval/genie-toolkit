// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

process.on('unhandledRejection', (up) => { throw up; });

const path = require('path');
const stream = require('stream');
const seedrandom = require('seedrandom');

const { BasicSentenceGenerator } = require('../../lib/sentence-generator/batch');
const { makeDummyEntities } = require('../../lib/utils/misc-utils');

const ThingTalk = require('thingtalk');
const NNSyntax = ThingTalk.NNSyntax;
const SchemaRetriever = ThingTalk.SchemaRetriever;

const _tpClient = require('./mock_schema_delegate');
const _schemaRetriever = new SchemaRetriever(_tpClient, null, true);

async function processOne(id, sentence, code) {
    const assignedEntities = {};

    try {
        const entities = makeDummyEntities(sentence);
        const program = NNSyntax.fromNN(code.split(' '), (token) => {
            return assignedEntities[token] = entities[token];
        });
        await program.typecheck(_schemaRetriever);

        const usedEntities = new Set;
        for (let token of sentence.split(' ')) {
            if (/^[A-Z]/.test(token)) { // entity
                if (!assignedEntities[token]) {
                    console.error(sentence);
                    console.error(code);
                    throw new Error(`Missing entity ${token} (present in the sentence, not in the code)`);
                }
                usedEntities.add(token);
            }
        }

        for (let token in assignedEntities) {
            if (!usedEntities.has(token))
                throw new Error(`Missing entity ${token} (present in the code, not in the sentence)`);
        }
    } catch(e) {
        console.error(sentence);
        console.error(code);
        throw e;
    }
}

async function doTest(filename) {
    const options = {
        rng: seedrandom.alea('almond is awesome'),
        locale: 'en-US',
        templateFiles: [filename],
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
        targetPruningSize: 20,
        maxDepth: 8,
        debug: true
    };

    const generator = new BasicSentenceGenerator(options);
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
    generator.pipe(writer);

    await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

async function main() {
    await doTest(path.resolve(path.dirname(module.filename), '../../languages/thingtalk/en/thingtalk.genie'));
    await doTest(path.resolve(path.dirname(module.filename), '../../languages/thingtalk/en/basic.genie'));
}
module.exports = main;
if (!module.parent)
    main();
