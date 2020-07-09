// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Silei <silei@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');
require('./test-classes/test_database');

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
         join @org.thingpedia.builtin.test.test_database(id="org.thingpedia.builtin.test.test_database").q2() => notify;
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

    const app = await engine.createApp(`now => aggregate count of (@org.thingpedia.builtin.test.test_database(id="org.thingpedia.builtin.test.test_database").q1()) => notify;`);

    assert(engine.apps.hasApp(app.uniqueId));

    const outputs = await collectOutputs(app);
    assert.deepStrictEqual(outputs, [{
        outputType: 'count(org.thingpedia.builtin.test.test_database:q1)',
        outputValue: { count: 1 }
    }]);
}

module.exports = async function testDatabase(engine) {
    await testSimpleDatabaseQuery(engine);
    await testJoinDatabaseQuery(engine);
    await testAggregateDatabaseQuery(engine);
};
