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

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const DeviceView = require('../lib/devices/device_view');

const SUCCESS = {};
const FAILURE = {};

module.exports = async function testDevices(engine) {
    const devices = engine.devices;

    // test looking up devices

    const builtin = devices.getAllDevicesOfKind('org.thingpedia.builtin.thingengine.builtin');
    assert.strictEqual(builtin.length, 1);
    assert.strictEqual(builtin[0], devices.getDevice('thingengine-own-global'));

    let test = devices.getAllDevicesOfKind('org.thingpedia.builtin.test');
    assert.strictEqual(test.length, 1);
    assert.strictEqual(test[0], devices.getDevice('org.thingpedia.builtin.test'));

    assert.deepStrictEqual(devices.getAllDevicesOfKind('messaging'), []);
    assert.deepStrictEqual(devices.getAllDevicesOfKind('com.xkcd'), []);

    // test device views, adding and removing devices

    let added = FAILURE;
    let removed = SUCCESS;
    const view = new DeviceView(devices, Ast.Selector.Device('com.xkcd', null, null));
    view.on('object-added', (d) => {
        assert.strictEqual(d, devices.getDevice('com.xkcd'));
        added = SUCCESS;
    });
    view.on('object-removed', () => {
        removed = FAILURE;
    });
    view.start();
    assert.deepStrictEqual(view.values(), []);

    let view2;

    const device = await devices.loadOneDevice({ kind: 'com.xkcd' }, true);

    const xkcd = devices.getAllDevicesOfKind('com.xkcd');
    assert.strictEqual(xkcd.length, 1);
    assert.strictEqual(xkcd[0], device);
    assert(devices.hasDevice('com.xkcd'));
    assert.strictEqual(devices.getDevice('com.xkcd'), device);

    const viewvalues = view.values();
    assert.strictEqual(viewvalues.length, 1);
    assert.strictEqual(viewvalues[0], device);

    assert.strictEqual(added, SUCCESS);
    assert.strictEqual(removed, SUCCESS);

    view.stop();
    view2 = new DeviceView(devices, Ast.Selector.Device('com.xkcd', null, null));
    // start the view before we connect to the signal, so we are sure not to receive it
    view2.start();
    view2.on('object-added', (d) => {
        assert.strictEqual(d, devices.getDevice('com.xkcd'));
        added = FAILURE;
    });
    view2.on('object-removed', () => {
        removed = SUCCESS;
    });

    const view3 = new DeviceView(devices, Ast.Selector.Device('com.xkcd', 'com.xkcd', null));
    view3.start();
    assert.strictEqual(view3.values().length, 1);
    view3.stop();

    const view4 = new DeviceView(devices, Ast.Selector.Device('com.xkcd', 'com.xkcd2', null));
    view4.start();
    assert.strictEqual(view4.values().length, 0);
    view4.stop();

    await devices.removeDevice(device);
    assert(!devices.hasDevice('com.xkcd'));
    assert.strictEqual(added, SUCCESS);
    assert.strictEqual(removed, SUCCESS);

    assert.deepStrictEqual(view2.values(), []);

    await devices.updateDevicesOfKind('com.xkcd');

    // should do (almost) nothing because there is no twitter configured

    await devices.updateDevicesOfKind('com.twitter');

    test = devices.getDevice('org.thingpedia.builtin.test');
    const result = await test.get_get_data({ count: 2, size: 10 });
    assert.deepStrictEqual(result, [{
        data: '!!!!!!!!!!',
    }, {
        data: '""""""""""'
    }]);

    const fakeState = {
        _state: {},
        get(key) {
            return this._state[key];
        },
        set(key, v) {
            this._state[key] = v;
            return v;
        }
    };

    return new Promise((resolve, reject) => {
        const test = devices.getDevice('org.thingpedia.builtin.test');

        const stream = test.subscribe_get_data({ size: 10 }, fakeState);
        const buffer = [];

        stream.on('data', (d) => {
            assert(d.hasOwnProperty('__timestamp'));
            delete d.__timestamp;
            buffer.push(d);
        });
        stream.on('end', () => reject(new Error('Unexpected end')));
        stream.on('error', reject);

        let atTimeout = null;
        setTimeout(() => {
            assert(buffer.length >= 4 && buffer.length <= 6);
            stream.destroy();
            atTimeout = buffer.length;
        }, 5000);
        setTimeout(() => {
            assert.strictEqual(buffer.length, atTimeout);
            assert.deepStrictEqual(buffer.slice(0, 4), [
                { data: '!!!!!!!!!!' },
                { data: '""""""""""' },
                { data: '##########' },
                { data: '$$$$$$$$$$' }
            ]);

            resolve();
        }, 10000);
    });
};
