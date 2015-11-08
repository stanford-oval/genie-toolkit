// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const crypto = require('crypto');
const Q = require('q');

const Protocol = require('../protocol');
const AppCompiler = require('../app_compiler');
const DeviceView = require('../device_view');
const ObjectSet = require('../object_set');

function getAuthToken() {
    var prefs = platform.getSharedPreferences();
    var authToken = prefs.get('auth-token');
    if (authToken === undefined) {
        // No auth token, generate one now with 256 random bits
        authToken = crypto.randomBytes(32).toString('hex');
        prefs.set('auth-token', authToken);
    }
    return authToken;
}

const SubscriptionWatcher = new lang.Class({
    Name: 'SubscriptionWatcher',

    _init: function(manager, messaging, feedId) {
        this._manager = manager;
        this._messaging = messaging;
        this._feed = messaging.getFeed(feedId);
    },

    _onNewMessage: function(msg) {
        try {
            if (!msg.text)
                return;
            var parsed = JSON.parse(msg.text);

            switch(parsed.op) {
            case 'source-data':
            case 'source-ready':
            case 'sink-ready':
                this._manager.checkSubscription(this._feed, parsed.subscriptionId);
                break;

            case 'subscribe':
                this._manager.handleSubscribe(this._feed, parsed.subscriptionId,
                                              parsed.authId, parsed.authSignature,
                                              parsed.selectors, parsed.channelName, parsed.mode,
                                              parsed.filters);
                break;

            case 'unsubscribe':
                this._manager.handleUnsubscribe(this._feed, parsed.subscriptionId);
                break;

            default:
                // ignore other stuff
            }
        } catch(e) {
            if (e.name !== 'SyntaxError')
                throw e;
            // else eat the error
        }
    },

    _onOldMessage: function(msg, unsub) {
        try {
            if (!msg.text)
                return;
            var parsed = JSON.parse(msg.text);

            switch(parsed.op) {
            case 'subscribe':
                if (unsub[parsed.subscriptionId] === true)
                    break;

                this._manager.handleSubscribe(this._feed, parsed.subscriptionId,
                                              parsed.authId, parsed.authSignature,
                                              parsed.selectors, parsed.channelName, parsed.mode,
                                              parsed.filters);
                break;

            case 'unsubscribe':
                unsub[parsed.subscriptionId] = true;
                break;

            default:
                // ignore other stuff
            }
        } catch(e) {
            if (e.name !== 'SyntaxError')
                throw e;
            // else eat the error
        }
    },

    _processOldSubscriptions: function() {
        var cursor = this._feed.getCursor();

        var now = new Date();
        var oneWeekAgo = now.getTime() - 24*3600*1000*7;
        var unsub = {};
        try {
            while (cursor.hasNext()) {
                var obj = cursor.next();
                if (this._feed.ownIds.indexOf(obj.senderId) >= 0)
                    continue;

                if (obj.serverTimestamp < oneWeekAgo)
                    break;
                this._onOldMessage(obj, unsub);
            }
        } finally {
            cursor.destroy();
        }
    },

    start: function() {
        return this._feed.open().then(function() {
            this._processOldSubscriptions();

            this._msgListener = this._onNewMessage.bind(this);
            this._feed.on('incoming-message', this._msgListener);
        }.bind(this));
    },

    stop: function() {
        this._feed.removeListener('incoming-message', this._msgListener);
        return this._feed.close();
    },
});

const SourceSubscription = new lang.Class({
    Name: 'SourceSubscription',

    _init: function(feed, subscriptionId, context, selectors, channelName, filters) {
        this._feed = feed;
        this._subscriptionId = subscriptionId;

        this._view = new DeviceView(null, context, selectors, channelName, 'r', filters);
        this._set = null;
        this._readyQueued = false;
    },

    _sendData: function(channelId, data) {
        this._feed.sendItem({ op: 'source-data',
                              subscriptionId: this._subscriptionId,
                              data: data,
                              channelId: channelId });
    },

    _sendReady: function() {
        this._feed.sendItem({ op: 'source-ready',
                              subscriptionId: this._subscriptionId });
    },

    _onData: function(from, data) {
        this._sendData(from.uniqueId, data);
    },

    _channelAdded: function(ch) {
        console.log('Connecting to data event on ' + ch.uniqueId);
        ch.on('data', this._dataListener);
        if (!this._readyQueued)
            this._sendData(ch.uniqueId, ch.event);
    },

    _channelRemoved: function(ch) {
        ch.removeListener('data', this._dataListener);
    },

    _ready: function() {
        this._readyQueued = false;
        set.values().forEach(function(ch) {
            this._sendData(ch.uniqueId, ch.event);
        }, this);
        this._sendReady();
    },

    refresh: function() {
        if (this._readyQueued)
            return;
        this._whenReady.then(function() {
            this._ready();
        }.bind(this));
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
            });
        });
        this._readyQueued = true;
        return this._whenReady.then(function() {
            this._ready();
        }.bind(this));
    }
});

const SinkSubscription = new lang.Class({
    Name: 'SinkSubscription',

    _init: function(feed, subscriptionId, context, selectors, channelName, filters) {
        this._feed = feed;
        this._subscriptionId = subscriptionId;

        this._view = new DeviceView(null, context, selectors, channelName, 'w', filters, false);
        this._set = null;

        this._readyQueued = false;
    },

    _sendReady: function() {
        this._feed.sendItem({ op: 'sink-ready',
                              subscriptionId: this._subscriptionId });
    },

    _sinkData: function(data) {
        this._whenReady.then(function() {
            setTimeout(function() {
                this._set.values().forEach(function(ch) {
                    console.log('Sending event on ' + ch.uniqueId);
                    ch.sendEvent(data);
                });
            }.bind(this), 0);
        }.bind(this));
    },

    _onNewMessage: function(msg) {
        try {
            var parsed = JSON.parse(msg.text);
            if (parsed.subscriptionId !== this._subscriptionId)
                return;

            console.log('Received Omlet message on SubscriptionSink: ', parsed);

            switch(parsed.op) {
            case 'sink-data':
                this._sinkData(parsed.data);
                break;
            default:
                // ignore other messages
                break;
            }
        } catch(e) {
            if (e.name === 'SyntaxError')
                console.log('Failed to parse incoming Omlet on proxy feed message: ' + e);
            else
                throw e;
        }
    },

    refresh: function() {
        if (this._readyQueued)
            return;
        this._whenReady.then(function() {
            this._readyQueued = false;
            this._sendReady();
        }.bind(this));
    },

    stop: function() {
        this._feed.removeListener('incoming-message', this._msgListener);
        return this._view.stop();
    },

    start: function() {
        this._msgListener = this._onNewMessage.bind(this);
        this._feed.on('incoming-message', this._msgListener);

        this._whenReady = this._view.start();
        this._readyQueued = true;
        return this._whenReady.then(function(set) {
            this._set = set;
            this._sendReady();
        }.bind(this));
    }
});

// This module handles incoming subscription requests on all feeds, checks for
// auth tokens and backs the request with an appropriate DeviceSelector
module.exports = new lang.Class({
    Name: 'MessagingSubscriptionManager',

    _init: function(devices, messaging) {
        this._devices = devices;
        this._messaging = messaging;

        this._subscriptionWatchers = {};
        this._subscriptions = {};

        this._activeRemoteGroups = {};

        this._deferredSubscriptions = {};
    },

    makeSubscriptionId: function(feed, authId, selectors, channelName, mode, filters) {
        var digest = crypto.createHash('sha256');
        return digest.digest(feed.feedId + '-' + authId + '-' +
                             Protocol.selectors.makeString(selectors) + '-'
                             + channelName + '-' + mode + Protocol.filters.makeString(filters))
            .toString('hex');
    },

    sendSubscribe: function(feed, authId, authSignature, selectors, channelName, mode, filters) {
        var subscriptionId = this.makeSubscriptionId(feed, authId, selectors, channelName, mode, filters);
        if (this._activeRemoteGroups[subscriptionId])
            return subscriptionId;

        this._activeRemoteGroups[subscriptionId] = true;

        feed.sendItem({ op: 'subscribe',
                        subscriptionId: subscriptionId,
                        authId: authId,
                        authSignature: authSignature,
                        selectors: Protocol.selectors.marshal(selectors),
                        channelName: channelName,
                        mode: mode,
                        filters: Protocol.filters.marshal(filters) });
        return subscriptionId;
    },

    sendUnsubscribe: function(feed, subscriptionId) {
        if (!this._activeRemoteGroups[subscriptionId])
            return;

        feed.sendItem({ op: 'unsubscribe',
                        subscriptionId: subscriptionId });
        delete this._activeRemoteGroups[subscriptionId];
    },

    checkSubscription: function(feed, subscriptionId) {
        if (this._activeRemoteGroups[subscriptionId] !== true)
            feed.sendItem({ op: 'unsubscribe', subscriptionId: subscriptionId });
    },

    makeAccessToken: function(uniqueId) {
        var hmac = crypto.createHmac('sha256', new Buffer(getAuthToken(), 'hex'));
        var sign = hmac.digest(uniqueId);
        return sign.toString('hex');
    },

    _verifyAuthorization: function(feed, authId, authSignature) {
        if (authSignature !== null) {
            return (this.makeAccessToken(authId) === authSignature ? 1 : 0);
        } else {
            // authenticate based on the group that "owns" authId
            if (!this._devices.hasDevice(authId)) {
                if (authId.startsWith('thingengine-compute-module-'))
                    return -1; // deferred
                else
                    return 0; // denied
            }

            var device = this._devices.getDevice(authId);
            if (device.kind !== 'thingengine-compute-module')
                return 0;
            if (device.verifyGroupAuthorization(feed))
                return 1;
            else
                return 0;
        }
    },

    handleSubscribe: function(feed, subscriptionId, authId, authSignature,
                              selectors, channelName, mode, filters) {
        console.log('Handling subscription ' + subscriptionId + ' to ' + authId);

        var auth = this._verifyAuthorization(feed, authId, authSignature);
        if (auth !== 1) {
            if (auth === -1) { // deferred
                console.log('Deferring subscription to ' + authId + ' until it appears');
                if (!(authId in this._deferredSubscriptions))
                    this._deferredSubscriptions[authId] = {};
                this._deferredSubscriptions[authId][subscriptionId] = { feed: feed,
                                                                        subscriptionId: subscriptionId,
                                                                        authId: authId,
                                                                        authSignature: authSignature,
                                                                        selectors: selectors,
                                                                        channelName: channelName,
                                                                        mode: mode,
                                                                        filters: filters };
            } else {
                feed.sendItem({ op: 'subscribe-error', msg: "Invalid token" });
            }
            return;
        }

        var fullId = feed.feedId + '-' + subscriptionId;
        if (fullId in this._subscriptions) {
            console.log('Duplicate subscription ' + fullId);
            this._subscriptions[fullId].refresh();
            return;
        }

        if (!this._devices.hasDevice(authId)) {
            feed.sendItem({ op: 'subscribe-error', msg: "Invalid device" });
            return;
        }

        try {
            selectors = Protocol.selectors.unmarshal(this._devices, selectors);
            filters = Protocol.filters.unmarshal(this._devices, filters);
        } catch(e) {
            console.log('Failed to unmarshal: ' + e.message);
            feed.sendItem({ op: 'subscribe-error', msg: "Protocol error" });
            return;
        }

        var groupDevice = this._devices.getDevice(authId);
        var context = groupDevice.queryInterface('device-group');

        if (context === null) {
            context = new ObjectSet.Simple();
            context.addOne(groupDevice);
            selectors = [AppCompiler.Selector.Any];
        }

        if (mode === 'r') {
            this._subscriptions[fullId] = new SourceSubscription(feed, subscriptionId, context,
                                                                 selectors, channelName, filters);
        } else if (mode === 'w') {
            this._subscriptions[fullId] = new SinkSubscription(feed, subscriptionId, context,
                                                               selectors, channelName, filters);
        } else {
            throw new Error('Invalid mode ' + mode);
        }

        this._subscriptions[fullId].start().done();
    },

    handleUnsubscribe: function(feed, subscriptionId) {
        var fullId = feed.feedId + '-' + subscriptionId;
        if (!(fullId in this._subscriptions)) {
            console.log('Invalid subscription ' + fullId);
            return;
        }

        this._subscriptions[fullId].stop().done();
        delete this._subscriptions[fullId];
    },

    _onDeviceAdded: function(device) {
        if (device.uniqueId in this._deferredSubscriptions) {
            var subs = this._deferredSubscriptions[device.uniqueId];
            delete this._deferredSubscriptions[device.uniqueId];
            for (var id in subs) {
                var sub = subs[id];
                this.handleSubscribe(sub.feed, sub.subscriptionId, sub.authId, sub.authSignature,
                                     sub.selectors, sub.channelName, sub.mode, sub.filters);
            }
        }
    },

    _onFeedAdded: function(feedId) {
        this._subscriptionWatchers[feedId] = new SubscriptionWatcher(this, this._messaging, feedId);
        this._subscriptionWatchers[feedId].start().done();
    },

    _onFeedRemoved: function(feedId) {
        var watcher = this._subscriptionWatchers[feedId];
        watcher.stop().done();
        delete this._subscriptionWatchers[feedId];
    },

    start: function() {
        this._deviceAddedListener = this._onDeviceAdded.bind(this);
        this._feedAddedListener = this._onFeedAdded.bind(this);
        this._feedRemovedListener = this._onFeedRemoved.bind(this);
        this._devices.on('device-added', this._deviceAddedListener);
        this._messaging.on('feed-added', this._feedAddedListener);
        this._messaging.on('feed-removed', this._feedRemovedListener);

        return this._messaging.getFeedList().then(function(feeds) {
            feeds.forEach(function(feedId) {
                this._onFeedAdded(feedId);
            }, this);
        }.bind(this));
    },

    stop: function() {
        this._devices.removeListener('device-added', this._deviceAddedListener);
        this._messaging.removeListener('feed-added', this._feedAddedListener);
        this._messaging.removeListener('feed-removed', this._feedRemovedListener);

        return Q();
    },
});
