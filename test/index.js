// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016-2018 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
Q.longStackSupport = true;
process.on('unhandledRejection', (up) => { throw up; });

const assert = require('assert');

const Engine = require('../lib/engine');

class MockAssistant {
    constructor() {
    }

    _setConversation(conv) {
        this._conv = conv;
    }

    getConversation(conv) {
        assert.strictEqual(conv, 'mock');
        return this._conv;
    }

    notifyAll(...data) {
        this._conv.notify(...data);
    }
    notifyErrorAll(...data) {
        this._conv.notifyError(...data);
    }
}

const THINGPEDIA_URL = 'https://almond-dev.stanford.edu/thingpedia';

async function runTests(engine, limitTo) {
    try {
        for (let x of ['devices', 'apps', 'http_client', 'util', 'builtins']) {
            if (limitTo !== undefined && x !== limitTo)
                continue;
            console.log(`Running ${x} tests`);
            await require('./test_' + x)(engine);
        }

        await engine.stop();
    } catch(e) {
        console.error('FAIL: ', e);
        process.exit(1);
    }
}

async function main() {
    const platform = require('./test_platform').newInstance();
    platform.setAssistant(new MockAssistant());

    const engine = new Engine(platform, { thingpediaUrl: THINGPEDIA_URL });
    await engine.open();

    runTests(engine, process.argv[2]);
    await engine.run();

    await engine.close();
}
main();
