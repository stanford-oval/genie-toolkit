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


import assert from 'assert';

import * as Tp from 'thingpedia';

async function testGetDateTime(engine) {
    const device = engine.devices.getDevice('thingengine-own-global');

    const [date] = await device.get_get_date();
    assert(date.date instanceof Date);
    assert.strictEqual(date.date.getHours(), 0);
    assert.strictEqual(date.date.getMinutes(), 0);
    assert.strictEqual(date.date.getSeconds(), 0);

    const [time] = await device.get_get_time();
    assert(time.time instanceof Tp.Value.Time);
}

async function testGetCommands(engine) {
    const device = engine.devices.getDevice('thingengine-own-global');

    for await (const d of await device.get_device()) {
        assert(d.id instanceof Tp.Value.Entity);
        assert(typeof d.id.value === 'string');
        assert(typeof d.id.display === 'string');
        assert(typeof d.description === 'string');
        assert(typeof d.category === 'string');
    }

    const result = await device.get_commands({ device: new Tp.Value.Entity('com.xkcd', 'tt:device', 'XKCD') });

    for await (const ex of result) {
        assert(typeof ex.id === 'string');
        assert(typeof ex.device === 'string');
        assert(ex.program instanceof Tp.Value.Entity);
    }
}

async function checkRandom(device, low, high, expectedLow, expectedHigh) {
    for (let _try = 0; _try < 1000; _try++) {
        const [random] = await device.get_get_random_between({ low, high });
        assert.strictEqual(typeof random.random, 'number');
        assert(random.random >= expectedLow, `got number ${random.random} which is less than ${expectedLow}`);
        assert(random.random <= expectedHigh, `got number ${random.random} which is more than ${expectedHigh}`);
        assert.strictEqual(Math.floor(random.random), random.random);
    }
}

async function testOtherBuiltins(engine) {
    const device = engine.devices.getDevice('thingengine-own-global');

    await checkRandom(device, 0, 7, 0, 7);
    await checkRandom(device, 7, 0, 0, 7);
    await checkRandom(device, undefined, undefined, 1, 6);

    await checkRandom(device, 2, undefined, 2, 7);
    await checkRandom(device, 10, undefined, 10, 20);
    await checkRandom(device, 100, undefined, 100, 200);
    await checkRandom(device, -100, undefined, -100, 0);
    await checkRandom(device, undefined, 1, 1, 1);
    await checkRandom(device, undefined, 10, 1, 10);
    await checkRandom(device, undefined, -2, -7, -2);
    await checkRandom(device, undefined, -10, -20, -10);
    await checkRandom(device, undefined, -100, -200, -100);
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

export default async function testBuiltins(engine) {
    await testBuiltinsAreExpected(engine);
    await testGetDateTime(engine);
    await testGetCommands(engine);
    await testOtherBuiltins(engine);
    await testPlatformDevice(engine);
}
