// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');

const Frontend = require('./frontend');
const EngineManager = require('./enginemanager');

function dropCaps() {
    if (process.getuid() == 0) {
        process.initgroups('thingengine', 'thingengine');
        process.setgid('thingengine');
        process.setuid('thingengine');
    }
}

var _frontend;
var _enginemanager;

function handleSignal() {
    _frontend.close().then(function() {
        if (_enginemanager)
            return _enginemanager.stop();
    }).then(function() {
        process.exit();
    }).done();
}

function main() {
    _frontend = new Frontend();

    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);

    // open the HTTP server
    _frontend.open().then(function() {
        // we bound the socket, no need for root now
        dropCaps();

        console.log('Starting EngineManager');
        _enginemanager = new EngineManager(_frontend);
        return _enginemanager.start();
    }).done();
}

main();
