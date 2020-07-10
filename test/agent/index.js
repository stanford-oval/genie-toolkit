// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2016-2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

process.on('unhandledRejection', (up) => { throw up; });

const assert = require('assert');
const fs = require('fs');
const byline = require('byline');
const util = require('util');
const path = require('path');
const yaml = require('js-yaml');
const seedrandom = require('seedrandom');

const { DialogueParser } = require('../../tool/lib/dialog_parser');
const StreamUtils = require('../../lib/utils/stream-utils');
const Conversation = require('../../lib/dialogue-agent/conversation');

const MockThingpediaClient = require('./mock_thingpedia_client');
const MockEngine = require('./mock_engine');

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
    conversation._nlu.onlineLearn = function(utterance, targetCode) {
        if (utterance === 'get an xkcd comic')
            assert.strictEqual(targetCode.join(' '), 'now => @com.xkcd.get_comic => notify');
        else if (utterance === '!! test command multiple results !!')
            assert.strictEqual(targetCode.join(' '), 'now => @com.twitter.post param:status:String = " multiple results "');
        else
            assert.fail(`Unexpected learned utterance ${utterance}`);
    };

    const commands = yaml.safeLoad(await util.promisify(fs.readFile)(
        path.resolve(path.dirname(module.filename), './mock-nlu.yaml')));

    const realSendUtterance = conversation._nlu.sendUtterance;
    conversation._nlu.sendUtterance = async function(utterance) {
        if (utterance === '!! test command host unreach !!') {
            const e = new Error('Host is unreachable');
            e.code = 'EHOSTUNREACH';
            throw e;
        }

        const tokens = utterance.split(' ');
        const entities = {};
        for (let command of commands) {
            if (command.utterance === utterance)
                return { tokens, entities, candidates: command.candidates };
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

async function roundtrip(testRunner, input, expected) {
    testRunner.nextTurn();

    const conversation = testRunner.conversation;
    if (input.startsWith('\\r {'))
        await conversation.handleParsedCommand(JSON.parse(input.substring(2)));
    else if (input.startsWith('\\r'))
        await conversation.handleParsedCommand({ code: input.substring(2).trim().split(' '), entities: {} });
    else if (input.startsWith('\\t'))
        await conversation.handleThingTalk(input.substring(2));
    else
        await conversation.handleCommand(input);

    if (expected !== null && testRunner.buffer.trim() !== expected.trim()) {
        console.error('Invalid reply: ' + testRunner.buffer.trim());
        console.error('\nExpected: ' + expected.trim());
        testRunner.anyFailed = true;
        return false;
    }
    return true;
}

async function test(testRunner, dlg, i) {
    console.log(`Test Case #${i+1}: ${dlg.id}`);

    testRunner.reset();

    // reset the conversation
    if (i > 0)
        await roundtrip(testRunner, '\\r bookkeeping special special:stop', null);

    for (let turn of dlg) {
        if (!await roundtrip(testRunner, turn.user, turn.agent))
            return;
    }
}

async function main(limit = Infinity) {
    const testRunner = new TestRunner();
    const rng = testRunner.rng.makeRNG();

    const tpClient = new MockThingpediaClient(testRunner);
    const engine = MockEngine.createMockEngine(tpClient, rng);

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
    testRunner.conversation = conversation;
    await mockNLU(conversation);
    await conversation.addOutput(delegate);
    await conversation.start();

    const TEST_CASES = await loadTestCases();
    for (let i = 0; i < Math.min(limit, TEST_CASES.length); i++)
        await test(testRunner, TEST_CASES[i], i);

    console.log('Done');
    process.exit(0);
}

main(parseInt(process.argv[2]) || Infinity);
