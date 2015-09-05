// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const events = require('events');
const lang = require('lang');
const Q = require('q');

const DeviceAvailability = {
    UNAVAILABLE: 0,
    AVAILABLE: 1,
    UNKNOWN: -1
};

module.exports = new lang.Class({
    Name: 'BaseDevice',
    Extends: events.EventEmitter,

    _init: function(engine) {
        // EventEmitter is a node.js class not a lang class,
        // can't chain up normally
        events.EventEmitter.call(this);

        this._engine = engine;
        this.availability = DeviceAvailability.UNKNOWN;

        this._channels = {};

        // Set this to a device specific ID plus something unique
        // (eg "bluetooth-aa-bb-cc-dd-ee-ff") so that no other device
        // can possibly have the same ID
        // If you leave it undefined, DeviceDatabase will pick for you
        this.uniqueId = undefined;
    },

    updateState: function(state) {
        // nothing to do here by default
    },

    serialize: function() {
        throw new Error('Not implemented');
    },

    get engine() {
        return this._engine;
    },

    // Note: unlike Channel and App there is no isSupported
    // because it is possible to instantiate a Device on any platform
    // return null from queryInterface() or throw exceptions from methods
    // if you can't do something from a specific platform

    // Perform an async check to verify if the device is available
    // (ie, on, working, reachable on the local network, etc.)
    // Returns a promise of the device availability
    checkAvailable: function() {
        return Q(DeviceAvailability.UNKNOWN);
    },

    // Check if this device corresponds to the abstract kind "kind",
    // ie, it's a bluetooth device, or a phone, or remote device,
    // or has an accelerometer, or whatever...
    // A device can have multiple kinds at the same time
    // Usually a kind corresponds to an extension interface, but not
    // all kinds have extension interfaces, and the device can expose
    // the kind without the interface if instantiated in the wrong
    // platform
    hasKind: function(kind) {
        return false;
    },

    // Request an extension interface for this device
    // Extension interfaces allow to provide additional device and
    // vendor specific capabilities without the use of channels
    // If the interface is not recognized this method returns null
    // (up to the caller to check it or just use it blindly and explode)
    //
    // Note that all method calls on the interface might fail if
    // the device is not available (but are not required to)
    // Also note that this method might return null if the device
    // exists but not locally (eg, it's a bluetooth device but we're
    // running on the server platform)
    queryInterface: function() {
        // no extension interfaces for this device class
        return null;
    },

    // Asynchronously get a channel for the device with the given id
    getChannel: function(id) {
        if (id in this._channels)
            return Q(this._channels[id]);

        return this._engine.channels.createDeviceChannel(id, device).then(function(channel) {
            return this._channels[id] = channel;
        });
    },
});

module.exports.DeviceAvailability = DeviceAvailability;
