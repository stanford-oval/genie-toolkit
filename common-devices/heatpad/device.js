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

const HeatPadDevice = new lang.Class({
    Name: 'HeatPadDevice',
    Extends: BaseDevice,

    _init: function(engine, state) {
        this.parent(engine, state);

        this.account = state.account;
        this.password = state.password;

        this.uniqueId = 'thingengine-device-heatpad-' + this.account;

        this.name = "Heatpad Device";
        this.description = "The device allows you to turn on/off your heatpad.";
    },

    get ownerTier() {
        return 'server';
    },

    checkAvailable: function() {
        return BaseDevice.Availability.AVAILABLE;
    },
});

function createDevice(engine, state) {
    return new HeatPadDevice(engine, state);
}

module.exports.createDevice = createDevice;
