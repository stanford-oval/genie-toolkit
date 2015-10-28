// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const lang = require('lang');

const BaseDevice = require('../../base_device');

// An abstraction for a named distributed database on top of
// of a messaging platform
//
// Every subscriber to the distributed database has read
// access, but write access is granted only to the owner of
// each tuple
// Tuples are keyed by owner (which is an opaque ID that depends
// on the implementation)
const DistributedDatabaseDevice = new lang.Class({
    Name: 'DistributedDatabaseDevice',
    Extends: BaseDevice,

    _init: function(engine, state) {
        this.parent(engine, state);

        this.name = "Distributed Database %s".format(this.feedId);
        this.description = "This is a Distributed Database using your phone's messaging platform. "
            + "You can use it to share your data with your friends!";
    },

    // The opaque token used by the messaging platform to identify
    // the distributed database feed
    get feedId() {
        return this.state.feedId;
    },

    get messagingDeviceId() {
        return this.state.messagingDeviceId;
    },

    getMessagingDevice: function() {
        var messagingDevices = this.engine.devices.getAllDevicesOfKind('messaging');
        var id = this.messagingDeviceId;
        if (id !== undefined)
            return messagingDevices.filter(function(d) { return d.uniqueId === id; })[0];
        else
            return messagingDevices[0];
    },

    checkAvailable: function() {
        var messagingDevices = this.engine.devices.getAllDevicesOfKind('messaging');

        if (messagingDevices.length > 0)
            return BaseDevice.Availability.AVAILABLE;
        else
            return BaseDevice.Availability.UNAVAILABLE;
    },
});

function createDevice(engine, state) {
    return new DistributedDatabaseDevice(engine, state);
}

module.exports.createDevice = createDevice;
