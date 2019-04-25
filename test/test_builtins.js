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

const assert = require('assert');

const Tp = require('thingpedia');
const ThingTalk = require('thingtalk');

async function testGetCommands(engine) {
    const device = engine.devices.getDevice('thingengine-own-global');

    const result = await device.get_get_commands({ device: new Tp.Value.Entity('com.xkcd', 'tt:device', 'XKCD') });

    for (let ex of result)
        assert(ex.program instanceof ThingTalk.Ast.Example);
}

async function testOtherBuiltins(engine) {
    const device = engine.devices.getDevice('thingengine-own-global');

    const now = new Date;

    const [date] = await device.get_get_date();
    assert(date.date instanceof Date);
    assert(date.date >= now);
    assert(date.date <= now.getTime() + 10000);

    const [time] = await device.get_get_time();
    assert(time.time instanceof Date);
    assert(time.time >= now);
    assert(time.time <= now.getTime() + 10000);

    const [random] = await device.get_get_random_between({ low: 0, high: 7 });
    assert.strictEqual(typeof random.random, 'number');
    assert(random.random >= 0);
    assert(random.random <= 7);
    assert.strictEqual(Math.floor(random.random), random.random);

    const [hello] = await device.get_canned_reply({ intent: 'hello' });
    assert.deepStrictEqual(hello, { text: "Hi!" });
}

function testBuiltinsAreExpected(engine) {
    // test that the built devices are what we expect

    const devices = engine.devices;

    assert(devices.hasDevice('thingengine-own-desktop'));
    assert(devices.hasDevice('thingengine-own-global'));
    assert(devices.hasDevice('org.thingpedia.builtin.test'));
    assert(!devices.hasDevice('org.thingpedia.builtin.thingengine.phone'));
    assert(!devices.hasDevice('org.thingpedia.builtin.thingengine.home'));
    assert(!devices.hasDevice('org.thingpedia.builtin.thingengine.gnome'));
}

module.exports = async function testBuiltins(engine) {
    await testBuiltinsAreExpected(engine);
    await testGetCommands(engine);
    await testOtherBuiltins(engine);
};
