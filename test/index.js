// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 The Board of Trustees of the Leland Stanford Junior University
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

// make all errors fatal
const originalconsoleerror = console.error;
console.error = function(errmsg, ...stuff) {
    originalconsoleerror(errmsg, ...stuff);
    process.exit(1);
};

const notifyBuffer = [];
const errorBuffer = [];
function clearBuffers() {
    notifyBuffer.length = 0;
    errorBuffer.length = 0;
}

class MockConversation {
    notify(...data) {
        notifyBuffer.push(data);
    }
    notifyError(...data) {
        errorBuffer.push(data);
    }
}

class MockAssistant {
    constructor() {
        this._conv = new MockConversation();
    }

    getConversation(conv) {
        assert.strictEqual(conv, 'mock');
        return this._conv;
    }

    notifyAll(...data) {
        this._conv.notify(...data);
    }
    notifyErrorAll(...data) {
        this._conv.notifyErrorAll(...data);
    }
}

const SUCCESS = {};
const FAILURE = {};

function testDevices(engine) {
    const devices = engine.devices;

    assert(devices.hasDevice('thingengine-own-desktop'));
    assert(devices.hasDevice('thingengine-own-global'));
    assert(devices.hasDevice('org.thingpedia.builtin.test'));
    assert(!devices.hasDevice('org.thingpedia.builtin.thingengine.phone'));
    assert(!devices.hasDevice('org.thingpedia.builtin.thingengine.home'));
    assert(!devices.hasDevice('org.thingpedia.builtin.thingengine.gnome'));

    const builtin = devices.getAllDevicesOfKind('org.thingpedia.builtin.thingengine.builtin');
    assert.strictEqual(builtin.length, 1);
    assert.strictEqual(builtin[0], devices.getDevice('thingengine-own-global'));

    const test = devices.getAllDevicesOfKind('org.thingpedia.builtin.test');
    assert.strictEqual(test.length, 1);
    assert.strictEqual(test[0], devices.getDevice('org.thingpedia.builtin.test'));

    assert.deepStrictEqual(devices.getAllDevicesOfKind('messaging'), []);
    assert.deepStrictEqual(devices.getAllDevicesOfKind('com.xkcd'), []);

    return devices.loadOneDevice({ kind: 'com.xkcd' }, true).then((device) => {
        const xkcd = devices.getAllDevicesOfKind('com.xkcd');
        assert.strictEqual(xkcd.length, 1);
        assert.strictEqual(xkcd[0], device);
        assert.strictEqual(devices.getDevice('com.xkcd'), device);
    });
}

function testApps(engine) {
}

function main() {
    var platform = require('./test_platform').newInstance();
    platform.setAssistant(new MockAssistant());

    var engine;
    Promise.resolve().then(() => {
        engine = new Engine(platform);
        return engine.open();
    }).then(() => {
        return testDevices(engine);
    }).then(() => {
        return testApps(engine);
    }).then(() => {
        return engine.close();
    });
}

main();
