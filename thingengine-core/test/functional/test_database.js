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

async function testSimpleDatabaseQuery(engine) {
    await engine.devices.addSerialized({ kind: 'org.thingpedia.builtin.test.test_database' });

    assert(engine.devices.hasDevice('org.thingpedia.builtin.test.test_database'));

    const app = await engine.createApp(`now => @org.thingpedia.builtin.test.test_database(id="org.thingpedia.builtin.test.test_database").q1() => notify;`);

    assert(engine.apps.hasApp(app.uniqueId));

    let what = await app.mainOutput.next();
    assert(what.item.isNotification);
    what.resolve();
    assert.strictEqual(what.item.outputType, 'org.thingpedia.builtin.test.test_database:q1');
    assert.deepStrictEqual(what.item.outputValue, { foo: ':-)' });

    what = await app.mainOutput.next();
    assert(what.item.isDone);
    what.resolve();
}

async function testJoinDatabaseQuery(engine) {
    await engine.devices.addSerialized({ kind: 'org.thingpedia.builtin.test.test_database' });

    assert(engine.devices.hasDevice('org.thingpedia.builtin.test.test_database'));

    const app = await engine.createApp(`
        now => @org.thingpedia.builtin.test.test_database(id="org.thingpedia.builtin.test.test_database").q1()
         join @org.thingpedia.builtin.test.test_database(id="org.thingpedia.builtin.test.test_database").q2() => notify;
    `);

    assert(engine.apps.hasApp(app.uniqueId));

    let what = await app.mainOutput.next();
    assert(what.item.isNotification);
    what.resolve();
    assert.strictEqual(what.item.outputType, 'org.thingpedia.builtin.test.test_database:q1+org.thingpedia.builtin.test.test_database:q2');
    assert.deepStrictEqual(what.item.outputValue, { foo: ':-)', bar: '(-:' });

    what = await app.mainOutput.next();
    assert(what.item.isDone);
    what.resolve();
}

async function testAggregateDatabaseQuery(engine) {
    await engine.devices.addSerialized({ kind: 'org.thingpedia.builtin.test.test_database' });

    assert(engine.devices.hasDevice('org.thingpedia.builtin.test.test_database'));

    const app = await engine.createApp(`now => aggregate count of (@org.thingpedia.builtin.test.test_database(id="org.thingpedia.builtin.test.test_database").q1()) => notify;`);

    assert(engine.apps.hasApp(app.uniqueId));

    let what = await app.mainOutput.next();
    assert(what.item.isNotification);
    what.resolve();
    assert.strictEqual(what.item.outputType, 'count(org.thingpedia.builtin.test.test_database:q1)');
    assert.deepStrictEqual(what.item.outputValue, { count: 1 });

    what = await app.mainOutput.next();
    assert(what.item.isDone);
    what.resolve();
}

module.exports = async function testDevices(engine) {
    await testSimpleDatabaseQuery(engine);
    await testJoinDatabaseQuery(engine);
    await testAggregateDatabaseQuery(engine);
};
