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
    }

    sendEvent: function(event) {
        this._feed.sendItem(JSON.stringify({ op: 'sink-data',
                                             subscription: this._subscriptionId,
                                             data: event }));
    },

    _onNewMessage: function(msg) {
        try {
            var parsed = JSON.parse(msg.text);
            if (parsed.subscription !== this._subscriptionId)
                return;

            console.log('Received Omlet message: ', parsed);

            switch(parsed.op) {
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
            console.log('Failed to parse incoming Omlet on proxy feed message: ' + e);
            console.log(e.stack);
        }
    },

    _doOpen: function() {
        return this._foreignIface.getFeed().then(function(feed) {
            this._msgListener = this._onNewMessage.bind(this);
            this._feed = feed;
            feed.on('incoming-message', this._msgListener);
-
            return feed.open();
        }.bind(this)).then(function() {
            return this._foreignIface.subscribe(this._device.authId,
                                                this._device.authSignature,
                                                this._selectors, this._mode,
                                                this._filters);
        }.bind(this).then(function(feed, subscriptionId) {
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

    _init: function(device, thingengine, foreignIface) {
        this.master = device;
        this.owner = thingengine;
        this._foreignIface = foreignIface;
    },

    getChannel: function(selectors, mode, filters) {
        // FIXME: reuse subscriptions by returning the same channel if needed
        return new RemoteGroupProxyChannel(this.master, this._foreignIface,
                                           selectors, mode, filters);
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
            try {
                var thingengine = this.engine.devices.getDevice(this.ownerId);
                var iface = thingengine.queryInterface('thingengine-foreign');
                if (iface !== null)
                    return new RemoteGroupProxy(this, thingengine, iface);
                else
                    return null;
            } catch (e) {
                return null;
            }
        } else {
            return null;
        }
    },
});

function createDevice(engine, state) {
    return new RemoteGroupDevice(engine, state);
}

module.exports.createDevice = createDevice;
