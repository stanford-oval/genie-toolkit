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

// A... "something", that lives off some IP and port address
// using some unknown protocol
const TestDevice = new lang.Class({
    Name: 'TestDevice',
    Extends: BaseDevice,

    _init: function(engine, hwAddress, host, port) {
        if (isNaN(port))
            throw new TypeError('Invalid port number ' + port);

        this.parent(engine);

        this.host = host;
        this.port = port;
        this.hwAddress = hwAddress;

        this.uniqueId = 'test-device-' + hwAddress.replace(/:/g,'-');
    },

    serialize: function() {
        return {kind:'test', host: this.host, port: this.port,
                hwAddress: this.hwAddress};
    },

    // we live on the public Internet!
    // ...or not
    // doesn't really matter
    checkAvailable: function() {
        return true;
    },
});

function createDevice(engine, serializedDevice) {
    return new TestDevice(engine,
                          serializedDevice.hwAddress,
                          serializedDevice.host,
                          parseInt(serializedDevice.port));
}

module.exports.createDevice = createDevice;
