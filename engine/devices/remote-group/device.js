// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const BaseDevice = require('../../base_device');

const RemoteGroupProxy = new lang.Class({
    Name: 'RemoteGroupProxy',

    _init: function(device) {
        this.master = device;
        console.log('Created RemoteGroupProxy for ' + device.uniqueId);
    },

    getChannel: function(selectors, mode, filters) {
        var master = this.master;
        var devices = master.engine.devices;
        var channels = master.engine.channels;
        var thingengineId = 'thingengine-foreign-phone-' + master.ownerId.replace(/[^a-z0-9]/g, '-');
        if (devices.hasDevice(thingengineId)) {
            var thingengine = Q(devices.getDevice(thingengineId));
        } else {
            var thingengine = devices.loadOneDevice({ kind: 'thingengine',
                                                      own: false,
                                                      tier: 'phone',
                                                      messagingId: master.ownerId }, false);
        }

        return thingengine.then(function(engine) {
            var iface = engine.queryInterface('thingengine-foreign');
            return channels.getChannel(master, iface, selectors, mode, filters);
        });
    },
});

const RemoteGroupDevice = new lang.Class({
    Name: 'RemoteGroupDevice',
    Extends: BaseDevice,

    _init: function(engine, state) {
        this.parent(engine, state);

        this.isTransient = state.isTransient;

        this.name = "Remote Group %s".format(this.state.name);
        this.description = "This is a group of devices on a different ThingEngine, that has been shared with you.";

        this.uniqueId = 'remote-group-' + this.ownerId + '-' + this.authId;
    },

    get ownerId() {
        return this.state.ownerId;
    },

    get authId() {
        return this.state.authId;
    },

    get authSignature() {
        return this.state.authSignature;
    },

    checkAvailable: function() {
        if (this.engine.messaging.isAvailable)
            return BaseDevice.Availability.AVAILABLE;
        else
            return BaseDevice.Availability.UNAVAILABLE;
    },

    queryInterface: function(iface) {
        if (iface === 'device-channel-proxy') {
            return new RemoteGroupProxy(this);
        } else {
            return null;
        }
    },
});

function createDevice(engine, state) {
    return new RemoteGroupDevice(engine, state);
}

module.exports.createDevice = createDevice;
