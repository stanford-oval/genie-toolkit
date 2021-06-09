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
// Author: Silei <silei@cs.stanford.edu>


import assert from 'assert';
import './test-classes/test_database';

async function collectOutputs(app) {
    let into = [];
    for await (const output of app.mainOutput)
        into.push(output);
    return into;
}

async function testSimpleDatabaseQuery(engine) {
    await engine.devices.addSerialized({ kind: 'org.thingpedia.builtin.test.test_database' });

    assert(engine.devices.hasDevice('org.thingpedia.builtin.test.test_database'));

    const app = await engine.createApp(`now => @org.thingpedia.builtin.test.test_database(id="org.thingpedia.builtin.test.test_database").q1() => notify;`);

    assert(engine.apps.hasApp(app.uniqueId));

    const outputs = await collectOutputs(app);
    assert.deepStrictEqual(outputs, [{
        outputType: 'org.thingpedia.builtin.test.test_database:q1',
        outputValue: { foo: ':-)' }
    }]);
}

async function testJoinDatabaseQuery(engine) {
    await engine.devices.addSerialized({ kind: 'org.thingpedia.builtin.test.test_database' });

    assert(engine.devices.hasDevice('org.thingpedia.builtin.test.test_database'));

    const app = await engine.createApp(`
        now => @org.thingpedia.builtin.test.test_database(id="org.thingpedia.builtin.test.test_database").q1()
         => @org.thingpedia.builtin.test.test_database(id="org.thingpedia.builtin.test.test_database").q2() => notify;
    `);

    assert(engine.apps.hasApp(app.uniqueId));

    const outputs = await collectOutputs(app);
    assert.deepStrictEqual(outputs, [{
        outputType: 'org.thingpedia.builtin.test.test_database:q1+org.thingpedia.builtin.test.test_database:q2',
        outputValue: { foo: ':-)', bar: '(-:' }
    }]);
}

async function testAggregateDatabaseQuery(engine) {
    await engine.devices.addSerialized({ kind: 'org.thingpedia.builtin.test.test_database' });

    assert(engine.devices.hasDevice('org.thingpedia.builtin.test.test_database'));

    const app = await engine.createApp(`now => count(@org.thingpedia.builtin.test.test_database(id="org.thingpedia.builtin.test.test_database").q1()) => notify;`);

    assert(engine.apps.hasApp(app.uniqueId));

    const outputs = await collectOutputs(app);
    assert.deepStrictEqual(outputs, [{
        outputType: 'count(org.thingpedia.builtin.test.test_database:q1)',
        outputValue: { count: 1 }
    }]);
}

export default async function testDatabase(engine) {
    await testSimpleDatabaseQuery(engine);
    await testJoinDatabaseQuery(engine);
    await testAggregateDatabaseQuery(engine);
}
