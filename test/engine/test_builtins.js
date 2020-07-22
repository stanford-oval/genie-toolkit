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

const assert = require('assert');

const Tp = require('thingpedia');

async function testGetDateTime(engine) {
    const device = engine.devices.getDevice('thingengine-own-global');

    const now = new Date;

    const [date] = await device.get_get_date();
    assert(date.date instanceof Date);
    assert(date.date >= now);
    assert(date.date <= now.getTime() + 10000);

    const [time] = await device.get_get_time();
    assert(time.time instanceof Tp.Value.Time);
}

async function testGetCommands(engine) {
    const device = engine.devices.getDevice('thingengine-own-global');

    const devices = await device.get_device();
    for (const d of devices) {
        assert(d.id instanceof Tp.Value.Entity);
        assert(typeof d.id.value === 'string');
        assert(typeof d.id.display === 'string');
        assert(typeof d.description === 'string');
        assert(typeof d.category === 'string');
    }

    const result = await device.get_commands({ device: new Tp.Value.Entity('com.xkcd', 'tt:device', 'XKCD') });

    for (let ex of result) {
        assert(typeof ex.id === 'string');
        assert(typeof ex.device === 'string');
        assert(ex.program instanceof Tp.Value.Entity);
    }
}

async function testOtherBuiltins(engine) {
    const device = engine.devices.getDevice('thingengine-own-global');

    const [random] = await device.get_get_random_between({ low: 0, high: 7 });
    assert.strictEqual(typeof random.random, 'number');
    assert(random.random >= 0);
    assert(random.random <= 7);
    assert.strictEqual(Math.floor(random.random), random.random);
}

function testBuiltinsAreExpected(engine) {
    // test that the built devices are what we expect

    const devices = engine.devices;

    assert(devices.hasDevice('thingengine-own-global'));
    assert(devices.hasDevice('org.thingpedia.builtin.test'));
    assert(!devices.hasDevice('org.thingpedia.builtin.thingengine.phone'));
    assert(!devices.hasDevice('org.thingpedia.builtin.thingengine.home'));
    assert(!devices.hasDevice('org.thingpedia.builtin.thingengine.gnome'));
}

async function testPlatformDevice(engine) {
    const devices = engine.devices;

    assert(devices.hasDevice('org.thingpedia.builtin.thingengine.test_platform'));

    const d = devices.getDevice('org.thingpedia.builtin.thingengine.test_platform');
    assert.deepStrictEqual(await d.get_foo(), [{ lol: 'yes' }]);
    assert.strictEqual(typeof d.subscribe_foo, 'function');
}

module.exports = async function testBuiltins(engine) {
    await testBuiltinsAreExpected(engine);
    await testGetDateTime(engine);
    await testGetCommands(engine);
    await testOtherBuiltins(engine);
    await testPlatformDevice(engine);
};
