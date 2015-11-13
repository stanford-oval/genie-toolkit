// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const Protocol = require('../../protocol');
const BaseChannel = require('../../base_channel');

const AppCompiler = require('../../app_compiler');
const DeviceView = require('../../device_view');
const ObjectSet = require('../../object_set');

const OwnSourceSubscription = new lang.Class({
    Name: 'OwnSourceSubscription',

    _init: function(ownId, messagingChannel, context, selectors, channelName, filters) {
        this._ownId = ownId;
        this._messagingChannel = messagingChannel;

        this._view = new DeviceView(null, context, selectors, channelName, 'r', filters);
        this._set = null;
        this._readyQueued = false;
    },

    _sendData: function(channelId, data) {
        this._messagingChannel.handleData(this._ownId, channelId, data);
    },

    _sendReady: function() {
        this._messagingChannel.handleSourceReady(this._ownId);
    },

    _onData: function(from) {
        this._sendData(from.uniqueId, from.event);
    },

    _channelAdded: function(ch) {
        console.log('Connecting to data event on ' + ch.uniqueId);
        ch.on('changed', this._dataListener);
        if (!this._readyQueued)
            this._sendData(ch.uniqueId, ch.event);
    },

    _channelRemoved: function(ch) {
        ch.removeListener('changed', this._dataListener);
    },

    _ready: function() {
        this._readyQueued = false;
        this._set.values().forEach(function(ch) {
            this._sendData(ch.uniqueId, ch.event);
        }, this);
        this._sendReady();
    },

    stop: function() {
        return this._view.stop();
    },

    start: function() {
        this._running = true;
        var self = this;
        this._dataListener = function(data) {
            var from = this;
            self._onData(from, data);
        };

        this._whenReady = this._view.start().then(function(set) {
            this._set = set;

            set.on('object-added', this._channelAdded.bind(this));
            set.on('object-removed', this._channelRemoved.bind(this));

            set.values().forEach(function(o) {
                this._channelAdded(o);
            }, this);
        }.bind(this));
        this._readyQueued = true;
        return this._whenReady.then(function() {
            this._ready();
        }.bind(this));
    }
});

const MessagingGroupProxyChannel = new lang.Class({
    Name: 'MessagingGroupProxyChannel',
    Extends: BaseChannel,

    _init: function(engine, state, device, targetDeviceId, selectors, channelName, mode, filters) {
        this.parent();

        this.engine = engine;
        this._state = state;
        this._device = device;
        this._targetDeviceId = targetDeviceId;
        this._selectors = selectors;
        this._channelName = channelName;
        this._mode = mode;
        this._filters = filters;
        this._values = {};
        this._ready = {};
        this._readyCount = -1;

        this.filterString = targetDeviceId + '-' + Protocol.selectors.makeString(selectors) + '-' +
            channelName + '-' + mode + Protocol.filters.makeString(filters);

        // "g.something" on read means something for all other people, but also something for ourselves
        // we handle this by creating a "something" ourselves
        this._ownSource = null;
    },

    values: function() {
        var values = [];
        for (var sender in this._values) {
            for (var channel in this._values[sender]) {
                if (Array.isArray(this._values[sender][channel]))
                    values = values.concat(this._values[sender][channel]);
                else
                    values.push(this._values[sender][channel]);
            }
        }
        return values;
    },

    setCurrentEvent: function(event) {
        this._state.set('values', event);
        this.parent(event);
    },

    sendEvent: function(event) {
        console.log('Sending broadcast event on group chat', event);
        this._feed.sendItem({ op: 'sink-data',
                              subscriptionId: this._subscriptionId,
                              data: event });
    },

    handleData: function(senderId, channelId, data) {
        if (!(senderId in this._values))
            this._values[senderId] = {};
        if (data !== undefined)
            this._values[senderId][channelId] = data;
        else
            delete this._values[senderId][channelId];
        //if (this._readyCount === 0)
            this.setCurrentEvent(this.values());
    },

    handleSourceReady: function(senderId) {
        console.log(senderId + ' is now ready for ' + this.uniqueId);
        if (!this._ready[senderId]) {
            this._ready[senderId] = true;
            this._readyCount--;
        }
        //if (this._readyCount === 0) {
            //console.log('Messaging group channel ' + this.uniqueId + ' is now ready');
            this.setCurrentEvent(this.values());
        //}
    },

    handleSinkReady: function(senderId) {
        if (!this._ready[senderId]) {
            this._ready[senderId] = true;
            this._readyCount--;
        }
    },

    _onNewMessage: function(msg) {
        try {
            if (!msg.text)
                return;
            var parsed = JSON.parse(msg.text);
            if (parsed.subscriptionId !== this._subscriptionId)
                return;

            console.log('Received Omlet message on MessagingGroupProxy: ', parsed);

            switch(parsed.op) {
            case 'subscribe-error':
                console.log("Subscription failed: " + parsed.msg);
                break;
            case 'source-data':
                this.handleData(msg.senderId, parsed.channelId, parsed.data);
                break;
            case 'source-ready':
                this.handleSourceReady(msg.senderId);
                break;
            case 'sink-ready':
                this.handleSinkReady(msg.senderId);
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
        this._values = this._state.get('values');
        if (this._values === undefined)
            this._values = {};
        this._msgListener = this._onNewMessage.bind(this);
        this._feed = this.engine.messaging.getFeed(this._device.feedId);
        this._feed.on('incoming-message', this._msgListener);
        return this._feed.open().then(function() {
            return this._feed.getMembers();
        }.bind(this)).then(function(members) {
            this._ready = {};
            this._readyCount = members.length;

            if (this._mode === 'r') {
                var groupDevice = this.engine.devices.getDevice(this._targetDeviceId);
                var context = groupDevice.queryInterface('device-group');
                var selectors;

                if (context === null) {
                    context = new ObjectSet.Simple();
                    context.addOne(groupDevice);
                    selectors = [AppCompiler.Selector.Any];
                } else {
                    selectors = this._selectors;
                }

                this._ownSource = new OwnSourceSubscription(this._feed.ownIds[0],
                                                            this,
                                                            context,
                                                            selectors,
                                                            this._channelName,
                                                            this._filters);
                return this._ownSource.start();
            } else {
                // count ourselves as always ready, and don't loop back the message
                this._ready[this._feed.ownIds[0]] = true;
                this._readyCount--;
                return Q();
            }
        }.bind(this)).then(function() {
            return this.engine.subscriptions.sendSubscribe(this._feed,
                                                           this._targetDeviceId,
                                                           null, // auth based on group not token
                                                           this._selectors,
                                                           this._channelName,
                                                           this._mode,
                                                           this._filters);
        }.bind(this)).then(function(subscriptionId) {
            this._subscriptionId = subscriptionId;
        }.bind(this));
    },

    _doClose: function() {
        this._feed.removeListener('incoming-message', this._msgListener);
        this.engine.subscriptions.sendUnsubscribe(this._feed, this._subscriptionId);

        return Q.try(function() {
            if (this._ownSource !== null)
                return this._ownSource.stop();
            else
                return Q();
        }.bind(this)).then(function() {
            return this._feed.close();
        }.bind(this));
    },
});

function createChannel(engine, state, device, targetDeviceId, selectors, channelName, mode, filters) {
    return new MessagingGroupProxyChannel(engine, state, device, targetDeviceId, selectors, channelName, mode, filters);
}
module.exports.createChannel = createChannel;
module.exports.requiredCapabilities = ['channel-state'];
