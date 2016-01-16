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
const ip = require('ip');

const Tier = {
    GLOBAL: 'global',
    PHONE: 'phone',
    SERVER: 'server',
    CLOUD: 'cloud'
};

const Availability = {
    UNAVAILABLE: 0,
    AVAILABLE: 1,
    UNKNOWN: -1
};

module.exports = new lang.Class({
    Name: 'BaseDevice',
    Abstract: true,
    Extends: events.EventEmitter,
    // no $rpc for queryInterface, extension interfaces are not exported
    $rpcMethods: ['get name', 'get uniqueId', 'get description',
                  'get ownerTier', 'get state',
                  'checkAvailable', 'hasKind'],

    _init: function(engine, state) {
        // EventEmitter is a node.js class not a lang class,
        // can't chain up normally
        events.EventEmitter.call(this);

        this._engine = engine;

        // Set this to a device specific ID plus something unique
        // (eg "mydevice-aa-bb-cc-dd-ee-ff") so that no other device
        // can possibly have the same ID
        // If you leave it undefined, DeviceDatabase will pick for you
        this.uniqueId = undefined;

        // Set these to protocol/discovery specific IDs (such as
        // "bluetooth-aa-bb-cc-dd-ee-ff") so that it is unlikely that
        // another device has the same ID
        this.descriptors = [];

        this.state = state;
        this.kind = state.kind;

        // Set to true if this device should not be stored in the devicedb
        // but only kept in memory (ie, its lifetime is managed by some
        // device discovery module)
        this.isTransient = false;

        this._ownerTier = undefined;
    },

    stateChanged: function() {
        this.emit('state-changed');
    },

    updateState: function(state) {
        // nothing to do here by default, except for updating the state
        // pointer
        // subclasses can override if they need to do anything about it
        this.state = state;
    },

    updateFromDiscovery: function(data) {
        // nothing to do here, subclasses can override if they support discovery
    },

    serialize: function() {
        if (!this.state)
            throw new Error('Device lost state, cannot serialize');
        return this.state;
    },

    get engine() {
        return this._engine;
    },

    // Return the tier that "owns" this device, ie, under what namespace
    // (@phone, @home or @cloud) this device appears
    // The device will appear unconditionally under @me
    //
    // Override this method to get smarter behavior
    get ownerTier() {
        if (this._ownerTier !== undefined)
            return this._ownerTier;

        // if the device wants to be cloud-only, then it belongs to the cloud
        if (this.hasKind('cloud-only'))
            return this._ownerTier = Tier.CLOUD;

        // if the device wants to be phone-only, then it belongs to the phone
        if (this.hasKind('phone-only'))
            return this._ownerTier = Tier.PHONE;

        // online accounts belong to the cloud
        if (this.hasKind('online-account'))
            return this._ownerTier = Tier.CLOUD;

        // if this device is on (some) local network, it belongs to home
        if (this.state) {
            if ('host' in this.state && ip.isPrivate(this.state.host))
                return this._ownerTier = Tier.SERVER;
            if ('ip-address' in this.state && ip.isPrivate(this.state['ip-address']))
                return this._ownerTier = Tier.SERVER;
        }

        // anything else belongs to the phone
        // (in particular, this means that physical devices with a cloud
        // attachment, or an omlet ID, get handled by the phone, which ensures
        // privacy and makes everyone happy)
        return this._ownerTier = Tier.CLOUD;
    },

    // Note: unlike Channel and App there is no isSupported
    // because it is possible to instantiate a Device on any platform
    // return null from queryInterface() or throw exceptions from methods
    // if you can't do something from a specific platform

    // Perform an async check to verify if the device is available
    // (ie, on, working, reachable on the local network, etc.)
    // Returns a promise of the device availability
    checkAvailable: function() {
        return Availability.UNKNOWN;
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
        return kind === this.kind;
    },

    // Check if this device was given the tag @tag by the user
    // Tag can be an arbitrary identifier, ie, livingroom or home or
    // work, and devices can have multiple tags.
    hasTag: function(tag) {
        if (this.state && Array.isArray(this.state.tags))
            return this.state.tags.indexOf(tag) >= 0;
        else
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

    // Get a channel that is identified with the given ID
    // The channel is instantiated for the given device
    getChannel: function(id, params) {
        if (this.ownerTier === this.engine.ownTier ||
            this.ownerTier === Tier.GLOBAL)
            return this.engine.channels.getOpenedChannel(this, id, params);
        else
            return this.engine.channels.getProxyChannel(this.ownerTier, this, id, params);
    }
});

module.exports.Availability = Availability;
module.exports.Tier = Tier;
