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


process.on('unhandledRejection', (up) => { throw up; });

import * as path from 'path';
import * as stream from 'stream';
import * as seedrandom from 'seedrandom';

import { BasicSentenceGenerator, DialogueGenerator } from '../../lib/sentence-generator/batch';
import { makeDummyEntities } from '../../lib/utils/misc-utils';

import { Syntax, SchemaRetriever } from 'thingtalk';

import _tpClient from './mock_schema_delegate';
const _schemaRetriever = new SchemaRetriever(_tpClient, null, true);

async function processOne(id, sentence, code) {
    const assignedEntities = {};

    try {
        const entities = makeDummyEntities(sentence);
        const program = Syntax.parse(code.split(' '), Syntax.SyntaxType.Tokenized, (token) => {
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

async function doTestBasic(filename) {
    const options = {
        rng: seedrandom.alea('almond is awesome'),
        locale: 'en-US',
        templateFiles: [filename],
        targetLanguage: 'thingtalk',
        thingpediaClient: _tpClient,
        flags: {
            turking: false,
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
        debug: 2
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

async function tryTypecheck(code) {
    if (!code)
        return;
    try {
        await Syntax.parse(code).typecheck(_schemaRetriever);
    } catch(e) {
        console.error(code);
        throw e;
    }
}

async function processDialogue(dlg) {
    for (let turn of dlg.turns) {
        await tryTypecheck(turn.context);
        await tryTypecheck(turn.agent_target);
        await tryTypecheck(turn.user_target);
    }
}


async function doTestDialogue(filename, onlyDevices = null) {
    const options = {
        rng: seedrandom.alea('almond is awesome'),
        locale: 'en-US',
        policyFile: path.resolve(path.dirname(module.filename), '../../languages/thingtalk/policy.yaml'),
        templateFiles: [filename],
        targetLanguage: 'thingtalk',
        thingpediaClient: _tpClient,
        flags: {
            turking: false,
            aggregation: true,
            bookkeeping: true,
            triple_commands: true,
            undefined_filter: true,
            timer: true,
            projection: true,
            projection_with_filter: true,
            dialogues: true,
            schema_org: true,

            // TODO
            notablejoin: true,
            nostream: true
        },
        onlyDevices,
        targetPruningSize: 25,
        maxDepth: 9,
        maxTurns: 3,
        minibatchSize: 300,
        numMinibatches: 1,
        debug: 2
    };

    const generator = new DialogueGenerator(options);
    const writer = new stream.Writable({
        objectMode: true,

        write(dlg, encoding, callback) {
            processDialogue(dlg).then(() => {
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
    await doTestBasic(path.resolve(path.dirname(module.filename), '../../languages/thingtalk/en/basic.genie'));
    await doTestBasic(path.resolve(path.dirname(module.filename), '../../languages/thingtalk/en/thingtalk.genie'));
    await doTestDialogue(path.resolve(path.dirname(module.filename), '../../languages/thingtalk/en/dialogue.genie'));
    // run again with just yelp weather and spotify, as way to check certain paths that don't come up otherwise
    await doTestDialogue(path.resolve(path.dirname(module.filename), '../../languages/thingtalk/en/dialogue.genie'),
    ['com.yelp', 'org.thingpedia.weather', 'com.spotify2']);
}
export default main;
if (!module.parent)
    main();
