// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const events = require('events');
const fs = require('fs');
const lang = require('lang');

const BaseDiscovery = require('./discovery');

module.exports = new lang.Class({
    Name: 'BluetoothDiscovery',
    Extends: BaseDiscovery,

    get isSupported() {
        return platform.hasCapability('bluetooth');
    },

    start: function() {
        this._btApi = platform.getCapability('bluetooth');

        this._listener = this._deviceDiscovered.bind(this);
        this._btApi.on('device-added', this._listener);
        this._btApi.on('device-changed', this._listener);

        return this._btApi.start();
    },

    stop: function() {
        this._btApi.removeListener('device-added', this._listener);
        this._btApi.removeListener('device-changed', this._listener);

        return Q();
    },

    _deviceDiscovered: function(btApiId, btDevice) {
        var descriptor = 'bluetooth/' + btDevice.address;
        var publicData = {
            kind: 'bluetooth',
            uuids: btDevice.uuids,
            class: btDevice.class
        };
        var privateData = {
            address: btDevice.address,
            alias: btDevice.alias,
            paired: btDevice.paired,
            trusted: btDevice.trusted
        };

        this.deviceFound(descriptor, publicData, privateData);
    }
});
