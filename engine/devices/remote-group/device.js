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
const BaseChannel = require('../../base_channel');
const ObjectSet = require('../../object_set');

const RemoteGroupProxyChannel = new lang.Class({
    Name: 'RemoteGroupProxyChannel',
    Extends: BaseChannel,

    _init: function(device, foreignIface, selectors, mode, filters) {
        this.parent();

        this._device = device;
        this._selectors = selectors;
        this._mode = mode;
        this._filters = filters;
        this._foreignIface = foreignIface;
        this._values = {};
        this._ready = false;

        this.uniqueId = device.uniqueId + '-group-proxy-' + (mode === 'w' ? 'sink' : 'source');
    },

    values: function() {
        var values = [];
        for (var k in this._values) {
            if (Array.isArray(this._values[k]))
                values = values.concat(this._values[k]);
            else
                values.push(this._values[k]);
        }
        return values;
    },

    sendEvent: function(event) {
        console.log('Sending event to remote ThingEngine', event);
        this._feed.sendItem({ op: 'sink-data',
                              subscription: this._subscriptionId,
                              data: event });
    },

    _onNewMessage: function(msg) {
        try {
            if (!msg.text)
                return;
            var parsed = JSON.parse(msg.text);
            if (parsed.subscription !== this._subscriptionId)
                return;

            console.log('Received Omlet message: ', parsed);

            switch(parsed.op) {
            case 'subscribe-error':
                console.log("Subscription failed: " + parsed.msg);
                break;
            case 'source-data':
                if (parsed.data !== undefined)
                    this._values[parsed.channelId] = parsed.data;
                else
                    delete this._values[parsed.channelId];
                if (this._ready)
                    this.emitEvent(this.values());
                break;
            case 'source-ready':
                this._ready = true;
                this.emitEvent(this.values());
                break;
            case 'sink-ready':
                this._ready = true;
                break;
            default:
                // ignore other messages (eg. unsubscribe)
                break;
            }
        } catch(e) {
            if (e.name === 'SyntaxError')
                console.log('Failed to parse incoming Omlet on proxy feed message: ' + e);
            else
                throw e;
        }
    },

    _doOpen: function() {
        return this._foreignIface.getFeed().then(function(feed) {
            this._msgListener = this._onNewMessage.bind(this);
            this._feed = feed;
            feed.on('incoming-message', this._msgListener);
            return feed.open();
        }.bind(this)).then(function() {
            return this._foreignIface.subscribe(this._device.authId,
                                                this._device.authSignature,
                                                this._selectors, this._mode,
                                                this._filters);
        }.bind(this)).then(function(subscriptionId) {
            this._subscriptionId = subscriptionId;
        }.bind(this));
    },

    _doClose: function() {
        this._feed.removeListener('incoming-message', this._msgListener);
        return this._foreignIface.unsubscribe(this._subscriptionId).then(function() {
            return this._feed.close();
        });
    },
});

const RemoteGroupProxy = new lang.Class({
    Name: 'RemoteGroupProxy',

    _init: function(device) {
        this.master = device;
        console.log('Created RemoteGroupProxy for ' + device.uniqueId);
    },

    getChannel: function(selectors, mode, filters) {
        var master = this.master;
        var devices = master.engine.devices;
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

            // FIXME: reuse subscriptions by returning the same channel if needed
            var channel = new RemoteGroupProxyChannel(master, iface,
                                                      selectors, mode, filters);
            return channel.open().then(function() { return channel; });
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
