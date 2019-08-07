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

const DeviceView = require('../lib/devices/device_view');

const SUCCESS = {};
const FAILURE = {};

function cleanInstanceID(infos) {
    infos.sort((a, b) => a.uniqueId.localeCompare(b.uniqueId));

    for (let info of infos) {
        if (info.uniqueId.startsWith('thingengine-own-desktop:')) {
            info.uniqueId = 'thingengine-own-desktop:XXXXXX';
            info.name = 'Almond desktop (XXXXXX)';
        }
    }
    return infos;
}

async function testLookup(engine) {
    const devices = engine.devices;

    const builtin = devices.getAllDevicesOfKind('org.thingpedia.builtin.thingengine.builtin');
    assert.strictEqual(builtin.length, 1);
    assert.strictEqual(builtin[0], devices.getDevice('thingengine-own-global'));

    let test = devices.getAllDevicesOfKind('org.thingpedia.builtin.test');
    assert.strictEqual(test.length, 1);
    assert.strictEqual(test[0], devices.getDevice('org.thingpedia.builtin.test'));

    assert.deepStrictEqual(devices.getAllDevicesOfKind('messaging'), []);
    assert.deepStrictEqual(devices.getAllDevicesOfKind('com.xkcd'), []);

    assert.deepStrictEqual(cleanInstanceID(await engine.getDeviceInfos()), [
     { uniqueId: 'org.thingpedia.builtin.test',
       name: 'Test Device',
       description: 'Test Almond in various ways',
       kind: 'org.thingpedia.builtin.test',
       version: 0,
       class: 'system',
       ownerTier: 'global',
       isTransient: true },
     { uniqueId: 'org.thingpedia.builtin.thingengine.remote',
       name: 'Remote Almond',
       description:
        'A proxy device for a Almond owned by a different user. This device is created and managed automatically by the system.',
       kind: 'org.thingpedia.builtin.thingengine.remote',
       version: 0,
       class: 'system',
       ownerTier: 'global',
       isTransient: true },
     { uniqueId: 'org.thingpedia.builtin.thingengine.test_platform',
       name: 'Unknown device',
       description: 'Description not available',
       kind: 'org.thingpedia.builtin.thingengine.test_platform',
       version: 0,
       class: 'data',
       ownerTier: 'global',
       isTransient: true },
     { uniqueId: 'thingengine-own-desktop:XXXXXX',
       name: 'Almond desktop (XXXXXX)',
       description: 'This is one of your own Almond apps.',
       kind: 'org.thingpedia.builtin.thingengine',
       version: 0,
       class: 'system',
       ownerTier: 'desktop',
       isTransient: false },
     { uniqueId: 'thingengine-own-global',
       name: 'Miscellaneous Interfaces',
       description: 'Time, randomness and other non-device specific things.',
       kind: 'org.thingpedia.builtin.thingengine.builtin',
       version: 0,
       class: 'data',
       ownerTier: 'global',
       isTransient: true }
    ]);
}

async function testDeviceViews(engine) {
    const devices = engine.devices;

    let added = FAILURE;
    let removed = SUCCESS;
    const view = new DeviceView(devices, 'com.xkcd', {});
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
    assert(device);

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
    view2 = new DeviceView(devices, 'com.xkcd', {});
    // start the view before we connect to the signal, so we are sure not to receive it
    view2.start();
    view2.on('object-added', (d) => {
        assert.strictEqual(d, devices.getDevice('com.xkcd'));
        added = FAILURE;
    });
    view2.on('object-removed', () => {
        removed = SUCCESS;
    });

    const view3 = new DeviceView(devices, 'com.xkcd', { id: 'com.xkcd' });
    view3.start();
    assert.strictEqual(view3.values().length, 1);
    view3.stop();

    const view4 = new DeviceView(devices, 'com.xkcd', { id: 'com.xkcd2' });
    view4.start();
    assert.strictEqual(view4.values().length, 0);
    view4.stop();

    await devices.removeDevice(device);
    assert(!devices.hasDevice('com.xkcd'));
    assert.strictEqual(added, SUCCESS);
    assert.strictEqual(removed, SUCCESS);

    assert.deepStrictEqual(view2.values(), []);
}

async function testUpdateDevice(engine) {
    const classes = await engine.devices.getCachedDeviceClasses();
    assert(classes.find((cls) => cls.name === 'com.xkcd' && cls.version >= 1));

    await engine.upgradeDevice('com.xkcd');

    // should do (almost) nothing because there is no twitter configured

    await engine.upgradeDevice('com.twitter');
}

async function testDeviceMethods(engine) {
    const devices = engine.devices;

    const test = devices.getDevice('org.thingpedia.builtin.test');
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
}

async function withTimeout(timeout, fn) {
    return new Promise((resolve, reject) => {
        Promise.resolve(fn()).then(resolve, reject);

        setTimeout(() => reject(new Error(`timed out`)), timeout);
    });
}

function autoSignalCleanup(obj, listeners) {
    function cleanup() {
        for (let sig in listeners)
            obj.removeListener(sig, listeners[sig]);
    }

    for (let sig in listeners)
        obj.on(sig, listeners[sig]);

    return cleanup;
}

async function testDeviceAddedRemoved(engine) {
    const devices = engine.devices;

    await withTimeout(10000, async () => {
        let added = FAILURE;
        let removed = SUCCESS;
        const cleanup = autoSignalCleanup(devices, {
            'device-added': (d) => {
                assert.strictEqual(d, devices.getDevice('com.xkcd'));
                added = SUCCESS;
            },
            'device-removed': () => {
                removed = FAILURE;
            }
        });

        const device = await devices.addSerialized({ kind: 'com.xkcd' });
        assert(device);

        assert.strictEqual(added, SUCCESS);
        assert.strictEqual(removed, SUCCESS);
        cleanup();
    });

    await withTimeout(10000, async () => {
        let added = SUCCESS;
        let removed = FAILURE;

        const device = devices.getDevice('com.xkcd');
        const cleanup = autoSignalCleanup(devices, {
            'device-added': (d) => {
                added = FAILURE;
            },
            'device-removed': (d) => {
                assert.strictEqual(d, device);
                removed = SUCCESS;
            }
        });

        await devices.removeDevice(device);
        assert.strictEqual(added, SUCCESS);
        assert.strictEqual(removed, SUCCESS);
        cleanup();
    });

    await withTimeout(10000, async () => {
        let added = FAILURE;
        let removed = SUCCESS;
        const cleanup = autoSignalCleanup(devices, {
            'device-added': (d) => {
                assert.strictEqual(d, devices.getDevice('org.thingpedia.builtin.test.collection-1'));
                added = SUCCESS;
            },
            'device-removed': () => {
                removed = FAILURE;
            }
        });

        const device = await devices.addSerialized({ kind: 'org.thingpedia.builtin.test.collection' });
        assert(device);

        assert.strictEqual(added, SUCCESS);
        assert.strictEqual(removed, SUCCESS);
        cleanup();
    });

    await withTimeout(10000, async () => {
        let added = FAILURE;
        let removed = SUCCESS;
        const cleanup = autoSignalCleanup(devices, {
            'device-added': (d) => {
                assert.strictEqual(d.kind, 'org.thingpedia.builtin.test.subdevice');
                assert.strictEqual(d.uniqueId, 'org.thingpedia.builtin.test.subdevice-one');
                assert.strictEqual(d.name, 'Test Subdevice one');
                assert.strictEqual(d.description, 'This is another Test, a Device, and also a Subdevice of org.thingpedia.builtin.test.collection-1');
                added = SUCCESS;
            },
            'device-removed': () => {
                removed = FAILURE;
            }
        });

        const master = devices.getDevice('org.thingpedia.builtin.test.collection-1');
        await master.addOne('one');

        assert.strictEqual(added, SUCCESS);
        assert.strictEqual(removed, SUCCESS);

        assert.strictEqual(devices.getAllDevicesOfKind('org.thingpedia.builtin.test.subdevice').length, 1);
        cleanup();
    });

    await withTimeout(10000, async () => {
        let added = SUCCESS;
        let removed = FAILURE;

        const cleanup = autoSignalCleanup(devices, {
            'device-added': (d) => {
                added = FAILURE;
            },
            'device-removed': (d) => {
                assert.strictEqual(d.uniqueId, 'org.thingpedia.builtin.test.subdevice-one');
                removed = SUCCESS;
            }
        });

        const master = devices.getDevice('org.thingpedia.builtin.test.collection-1');
        await master.removeOne('one');
        assert.strictEqual(added, SUCCESS);
        assert.strictEqual(removed, SUCCESS);
        cleanup();
    });

    await withTimeout(10000, async () => {
        let added = FAILURE;
        let removed = SUCCESS;
        const cleanup = autoSignalCleanup(devices, {
            'device-added': (d) => {
                assert.strictEqual(d.kind, 'org.thingpedia.builtin.test.subdevice');
                assert.strictEqual(d.uniqueId, 'org.thingpedia.builtin.test.subdevice-two');
                assert.strictEqual(d.name, 'Test Subdevice two');
                assert.strictEqual(d.description, 'This is another Test, a Device, and also a Subdevice of org.thingpedia.builtin.test.collection-1');
                added = SUCCESS;
            },
            'device-removed': () => {
                removed = FAILURE;
            }
        });

        const master = devices.getDevice('org.thingpedia.builtin.test.collection-1');
        await master.addOne('two');

        assert.strictEqual(added, SUCCESS);
        assert.strictEqual(removed, SUCCESS);
        cleanup();

        assert.strictEqual(devices.getAllDevicesOfKind('org.thingpedia.builtin.test.subdevice').length, 1);
    });

    // removing the master device will also remove all subdevices currently present
    await withTimeout(10000, async () => {
        let added = SUCCESS;
        let removedmaster = FAILURE;
        let removedsub = FAILURE;

        const master = devices.getDevice('org.thingpedia.builtin.test.collection-1');
        assert.strictEqual(master._collection.values().length, 1);

        const cleanup = autoSignalCleanup(devices, {
            'device-added': (d) => {
                added = FAILURE;
            },
            'device-removed': (d) => {
                if (d.kind === 'org.thingpedia.builtin.test.subdevice') {
                    assert.strictEqual(d.uniqueId, 'org.thingpedia.builtin.test.subdevice-two');
                    assert.strictEqual(removedsub, FAILURE);
                    removedsub = SUCCESS;
                } else {
                    assert.strictEqual(d, master);
                    assert.strictEqual(removedmaster, FAILURE);
                    removedmaster = SUCCESS;
                }
            }
        });

        await devices.removeDevice(master);
        assert.strictEqual(added, SUCCESS);
        assert.strictEqual(removedmaster, SUCCESS);
        assert.strictEqual(removedsub, SUCCESS);
        cleanup();
    });
}

module.exports = async function testDevices(engine) {
    await testLookup(engine);
    await testDeviceViews(engine);
    await testUpdateDevice(engine);
    await testDeviceMethods(engine);
    await testDeviceAddedRemoved(engine);
};
