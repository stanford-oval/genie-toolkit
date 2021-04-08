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

import assert from 'assert';
import * as fs from 'fs';
import byline from 'byline';
import * as util from 'util';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as seedrandom from 'seedrandom';

import { DialogueParser } from '../../lib';
import * as StreamUtils from '../../lib/utils/stream-utils';
import Conversation from '../../lib/dialogue-agent/conversation';

import MockThingpediaClient from './mock_thingpedia_client';
import * as MockEngine from './mock_engine';

import MultiJSONDatabase from '../../tool/lib/multi_json_database';

class RestartableRandomNumberGenerator {
    constructor() {
        this.reset();
    }

    reset() {
        this._real = seedrandom.alea('almond is awesome');
    }

    _next() {
        return this._real();
    }

    makeRNG() {
        return this._next.bind(this);
    }
}

class TestRunner {
    constructor() {
        this.anyFailed = false;
        this._buffer = '';
        this.rng = new RestartableRandomNumberGenerator;
    }

    get buffer() {
        return this._buffer;
    }

    reset() {
        this.rng.reset();
        this.nextTurn();
    }

    nextTurn() {
        this._buffer = '';
    }

    writeLine(line) {
        this._buffer += line + '\n';
    }
}

function checkIcon(msg) {
    assert((typeof msg.icon === 'string' && msg.icon) || msg.icon === null);
}

class TestDelegate {
    constructor(testRunner) {
        this._testRunner = testRunner;
    }

    setHypothesis(hypothesis) {
        // do nothing
    }
    setExpected(expect, context) {
        this._testRunner.writeLine('>> context = ' + context.code.join(' ') + ' // ' + JSON.stringify(context.entities));
        this._testRunner.writeLine('>> expecting = ' + expect);
    }

    addMessage(msg) {
        switch (msg.type) {
        case 'text':
            checkIcon(msg);
            this._testRunner.writeLine(msg.text);
            // die horribly if something does not work (and it's not a test error)
            if (msg.text.indexOf('that did not work') >= 0 && msg.text.indexOf('I do not like that location') < 0)
                setImmediate(() => process.exit(1));
            break;

        case 'result':
            checkIcon(msg);
            this._testRunner.writeLine(`${msg.constructor.name} ${msg.text}`);
            break;

        case 'picture':
            checkIcon(msg);
            this._testRunner.writeLine('picture: ' + msg.url);
            break;

        case 'rdl':
            checkIcon(msg);
            this._testRunner.writeLine('rdl: ' + msg.rdl.displayTitle + ' ' + (msg.rdl.callback || msg.rdl.webCallback));
            break;

        case 'choice':
            this._testRunner.writeLine('choice ' + msg.idx + ': ' + msg.title);
            break;

        case 'link':
            this._testRunner.writeLine('link: ' + msg.title + ' ' + msg.url);
            break;

        case 'button':
            if (typeof msg.json !== 'object')
                console.error(msg.json);
            assert(typeof json === 'object');
            assert(Array.isArray(msg.json.code) ||
                   typeof msg.json.program === 'string' ||
                   typeof msg.json.permissionRule === 'string');
            if (msg.json.slots) {
                msg.json.slots.forEach((slot) => {
                    assert(msg.title.indexOf('$' + slot) >= 0, `button ${msg.title} is missing slot ${slot}`);
                });
            }
            this._testRunner.writeLine('button: ' + msg.title + ' ' + JSON.stringify(msg.json));
            break;

        case 'new-program':
            console.log(JSON.stringify(msg));
            break;
        }
    }
}

class MockUser {
    constructor() {
        this.name = 'Alice Tester';
        this.isOwner = true;
        this.anonymous = false;
    }
}

async function mockNLU(conversation) {
    // inject some mocking in the parser:
    conversation._loop._nlu.onlineLearn = function(utterance, targetCode) {
        if (utterance === 'get an xkcd comic')
            assert.strictEqual(targetCode.join(' '), 'now => @com.xkcd.get_comic => notify');
        else if (utterance === '!! test command multiple results !!')
            assert.strictEqual(targetCode.join(' '), 'now => @com.twitter.post param:status:String = " multiple results "');
        else
            assert.fail(`Unexpected learned utterance ${utterance}`);
    };

    const commands = yaml.load(await util.promisify(fs.readFile)(
        path.resolve(path.dirname(module.filename), './mock-nlu.yaml')));

    const realSendUtterance = conversation._loop._nlu.sendUtterance;
    conversation._loop._nlu.sendUtterance = async function(utterance) {
        if (utterance === '!! test command host unreach !!') {
            const e = new Error('Host is unreachable');
            e.code = 'EHOSTUNREACH';
            throw e;
        }

        const tokens = utterance.split(' ');
        const entities = {};
        for (let command of commands) {
            if (command.utterance === utterance) {
                if (command.error) {
                    const err = new Error(command.error.message);
                    err.code = command.error.code;
                    throw err;
                }
                return { tokens, entities, candidates: command.candidates, intent: { ignore: 0, command: 1, other: 0 } };
            }
        }

        return realSendUtterance.apply(this, arguments);
    };
}

async function loadTestCases() {
    const testfile = path.resolve(path.dirname(module.filename), './tests.txt');

    return fs.createReadStream(testfile, { encoding: 'utf8' })
        .pipe(byline())
        .pipe(new DialogueParser({ withAnnotations: false, invertTurns: true }))
        .pipe(new StreamUtils.ArrayAccumulator())
        .read();
}

function expect(testRunner, expected) {
    if (expected === null)
        return;

    if (testRunner.buffer.trim() !== expected.trim()) {
        console.error('Invalid reply: ' + testRunner.buffer.trim());
        console.error('\nExpected: ' + expected.trim());
        throw new Error('test failed');
    }
}

async function roundtrip(testRunner, input, expected) {
    testRunner.nextTurn();

    const conversation = testRunner.conversation;
    if (input.startsWith('\\r {'))
        await conversation.handleParsedCommand(JSON.parse(input.substring(2)));
    else if (input.startsWith('\\r'))
        await conversation.handleParsedCommand({ code: input.substring(2).trim().split(' '), entities: {} });
    else if (input.startsWith('\\t'))
        await conversation.handleThingTalk(input.substring(2).trim());
    else
        await conversation.handleCommand(input);

    expect(testRunner, expected);
}

async function test(testRunner, dlg, i) {
    console.log(`Test Case #${i+1}: ${dlg.id}`);

    testRunner.reset();

    // reset the conversation
    if (i > 0)
        await roundtrip(testRunner, '\\r bookkeeping special special:stop', null);

    for (let turn of dlg)
        await roundtrip(testRunner, turn.user, turn.agent);
}

async function main(onlyIds) {
    const testRunner = new TestRunner();
    const rng = testRunner.rng.makeRNG();

    const database_path = path.resolve(path.dirname(module.filename), '../data/en-US/dataset-map.tsv');
    const database = new MultiJSONDatabase(database_path);
    await database.load();

    const tpClient = new MockThingpediaClient(testRunner);
    const engine = MockEngine.createMockEngine(tpClient, rng, database);

    // intercept createApp
    const delegate = new TestDelegate(testRunner);

    const nluServerUrl = 'https://nlp-staging.almond.stanford.edu';
    const conversation = new Conversation(engine, 'test', new MockUser(), {
        nluServerUrl: nluServerUrl,
        nlgServerUrl: null,
        debug: true,
        testMode: true,
        showWelcome: true,
        anonymous: false,
        rng: rng,
    });
    conversation.startRecording();
    testRunner.conversation = conversation;
    await mockNLU(conversation);
    await conversation.addOutput(delegate);
    await conversation.start();

    // test the welcome message (and the context at the start)
    expect(testRunner, `
Hello! How can I help you?
>> context = null // {}
>> expecting = null
`);

    const TEST_CASES = await loadTestCases();
    for (let i = 0; i < TEST_CASES.length; i++) {
        if (onlyIds.length > 0 && !onlyIds.includes(TEST_CASES[i].id))
            continue;
        await test(testRunner, TEST_CASES[i], i);
        conversation.voteLast(i % 2 ? 'up' : 'down');
        conversation.commentLast('test comment for dialogue turns\nadditional\nlines');
    }

    await conversation.saveLog();
    conversation.endRecording();

    const log = fs.readFileSync(conversation.log).toString()
        .replace(/^#! timestamp: 202[1-9]-[01][0-9]-[0123][0-9]T[012][0-9]:[0-5][0-9]:[0-5][0-9](\.[0-9]+)Z$/gm,
                 '#! timestamp: XXXX-XX-XXTXX:XX:XX.XXXZ');
    //fs.writeFileSync(path.resolve(__dirname, './expected-log.txt'), log);
    const expectedLog = fs.readFileSync(path.resolve(__dirname, './expected-log.txt')).toString();
    assert(log === expectedLog);

    console.log('Done');
    process.exit(0);
}

main(process.argv.slice(2));
