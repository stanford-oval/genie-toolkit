// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const BaseDevice = require('../base_device');

// An instance of a ThingEngine server platform running remotely, as discovered
// by bluetooth, mdns or whatever

const ThingEngineDevice = new lang.Class({
    Name: 'ThingEngineDevice',
    Extends: BaseDevice,

    _init: function(engine, host, port) {
        if (isNaN(port))
            throw new TypeError('Invalid port number ' + port);

        this.parent(engine);

        this.host = host;
        this.port = port;

        this.uniqueId = 'thingengine-server-' + host + '-' + port;
    },

    serialize: function() {
        return {kind:'thingengine', host: this.host, port: this.port};
    },

    checkAvailable: function() {
        // FIXME: ping the server!
        return this.parent();
    },

    hasKind: function(kind) {
        if (kind == 'thingengine-server')
            return true;
        else
            return this.parent();
    },
});

function createDevice(engine, serializedDevice) {
    return new ThingEngineDevice(engine, serializedDevice.host, parseInt(serializedDevice.port));
}

module.exports.createDevice = createDevice;
