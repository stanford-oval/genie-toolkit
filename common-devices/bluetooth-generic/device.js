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

const BluetoothGenericDevice = new lang.Class({
    Name: 'BluetoothGenericDevice',
    Extends: BaseDevice,

    _init: function(engine, state) {
        this.parent(engine, state);

        this.alias = state.alias;
        this.hwAddress = state.hwAddress;

        this.uniqueId = 'bluetooth-generic-' + state.hwAddress.replace(/:/g,'-');
        this.descriptors = ['bluetooth/' + state.hwAddress];

        this.name = "Bluetooth Device %s".format(this.alias);
        this.description = "This is a Bluetooth device of unknown or generic type";
    }

    // no override for checkAvailable because I'm lazy and I don't want to poke through
    // bluetooth
});

function createDevice(engine, state) {
    return new BluetoothGenericDevice(engine, state);
}

module.exports.createDevice = createDevice;

function addFromDiscovery(engine, publicData, privateData) {
    if (privateData.paired) {
        engine.devices.loadOneDevice({ kind: 'bluetooth-generic',
                                       uuids: publicData.uuids,
                                       class: publicData.class,
                                       hwAddress: privateData.address,
                                       alias: privateData.alias }, true);
    } else {
        // FINISHME: ask the user to pair the device then add it
    }
}

module.exports.addFromDiscovery = addFromDiscovery;
