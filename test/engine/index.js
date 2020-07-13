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

const Q = require('q');
Q.longStackSupport = true;
process.on('unhandledRejection', (up) => { throw up; });

// require(thingpedia) to initialize the polyfill
require('thingpedia');

const Engine = require('../../lib/engine');

const THINGPEDIA_URL = 'https://almond-dev.stanford.edu/thingpedia';
const THINGENGINE_URL = 'https://almond-dev.stanford.edu';

async function runTests(engine, limitTo) {
    try {
        for (let x of ['devices', 'apps', 'database', 'http_client', 'builtins', 'cloud_sync']) {
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
    const platform = require('./platform').newInstance();
    const engine = new Engine(platform, {
        thingpediaUrl: THINGPEDIA_URL,
        cloudSyncUrl: THINGENGINE_URL
    });
    await engine.open();
    await engine.assistant.openConversation('mock');

    runTests(engine, process.argv[2]);
    await engine.run();

    await engine.close();
}
main();
