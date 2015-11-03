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
            var parsed = JSON.parse(msg.text);

            switch(parsed.op) {
            case 'subscribe':
                this._manager.handleSubscribe(this._feed, parsed.subscriptionId,
                                              parsed.authId, parsed.authSignature,
                                              parsed.selectors, parsed.mode,
                                              parsed.filters);
                break;

            case 'unsubscribe':
                this._manager.handleUnsubscribe(this._feed, parsed.subscriptionId);
                break;

            default:
                // ignore other stuff
            }
        } catch(e) {
            console.log('Failed to parse Omlet message as JSON');
            console.log(e.stack);
        }
    },

    _processOldSubscriptions: function() {
        return this._messaging.getOwnIds().then(function(ownIds) {
            var cursor = this._feed.getCursor();

            try {
                while (cursor.hasNext()) {
                    var obj = cursor.next();
                    if (ownIds.indexOf(obj.senderId) >= 0)
                        continue;

                    this._onNewMessage(obj);
                }
            } finally {
                cursor.destroy();
            }
        });
    },

    start: function() {
        this._msgListener = this._onNewMessage.bind(this);
        this._feed.on('incoming-message', this._msgListener);

        return this._feed.open().then(function() {
            return this._processOldSubscriptions();
        }.bind(this));
    },

    stop: function() {
        this._feed.removeListener('incoming-message', this._msgListener);
        return this._feed.close();
    },
});

const SourceSubscription = new lang.Class({
    Name: 'SourceSubscription',

    _init: function(feed, subscriptionId, context, selectors, filters) {
        this._feed = feed;
        this._subscriptionId = subscriptionId;

        this._view = new DeviceView(null, context, selectors, 'r', filters);
        this._set = null;
    },

    _sendData: function(channelId, data) {
        this._feed.sendItem(JSON.stringify({ op: 'source-data',
                                             subscriptionId: this._subscriptionId,
                                             data: data,
                                             channelId: channelId }));
    },

    _sendReady: function() {
        this._feed.sendItem(JSON.stringify({ op: 'source-ready',
                                             subscriptionId: this._subscriptionId }));
    },

    _onData: function(from, data) {
        this._sendData(from.uniqueId, data);
    },

    _channelAdded: function(ch) {
        console.log('Connecting to data event on ' + ch.uniqueId);
        ch.on('data', this._dataListener);
    },

    _channelRemoved: function(ch) {
        ch.removeListener('data', this._dataListener);
    },

    _ready: function() {
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

        return this._view.start().then(function(set) {
            this._set = set;

            set.on('object-added', this._channelAdded.bind(this));
            set.on('object-removed', this._channelRemoved.bind(this));

            set.values().forEach(function(o) {
                this._channelAdded(o);
            });
            this._ready();
        });
    }
});

const SinkSubscription = new lang.Class({
    Name: 'SinkSubscription',

    _init: function(feed, subscriptionId, context, selectors, filters) {
        this._feed = feed;
        this._subscriptionId = subscriptionId;

        this._view = new DeviceView(null, context, selectors, 'w', filters, false);
        this._set = null;
    },

    _sendReady: function() {
        this._feed.sendItem(JSON.stringify({ op: 'sink-ready',
                                             subscriptionId: this._subscriptionId }));
    },

    _sinkData: function(data) {
        this._whenReady.then(function(set) {
            set.values().forEach(function(ch) {
                ch.sendEvent(data);
            });
        });
    },

    _onNewMessage: function(msg) {
        try {
            var parsed = JSON.parse(msg.text);
            if (parsed.subscription !== this._subscriptionId)
                return;

            console.log('Received Omlet message: ', parsed);

            switch(parsed.op) {
            case 'sink-data':
                this._sinkData(parsed.data);
                break;
            default:
                // ignore other messages
                break;
            }
        } catch(e) {
            console.log('Failed to parse incoming Omlet on proxy feed message: ' + e);
            console.log(e.stack);
        }
    },

    stop: function() {
        this._feed.removeListener('incoming-message', this._msgListener);
        return this._view.stop();
    },

    start: function() {
        this._msgListener = this._onNewMessage.bind(this);
        this._feed.on('incoming-message', this._msgListener);

        this._whenReady = this._view.start();
        return this._whenReady.then(function(set) {
            this._set = set;
            this._sendReady();
        });
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
    },

    handleSubscribe: function(feed, subscriptionId, authId, authSignature, selectors, mode, filters) {
        // FIXME: filters

        var hmac = crypto.createHmac('sha256', new Buffer(platform.getAuthToken(), 'hex'));
        var sign = hmac.digest(authId);
        if (sign !== authSignature) {
            feed.sendItem({ op: 'subscribe-error', msg: "Invalid signature" });
            return;
        }

        var fullId = feed.identifier + '-' + subscriptionId;
        if (fullId in this._subscriptions) {
            console.log('Duplicate subscription ' + fullId);
            return;
        }

        try {
            var groupDevice = this._devices.getDevice(authId);
            var context = groupDevice.queryInterface('device-group');

            if (mode === 'r') {
                this._subscriptions[fullId] = new SourceSubscription(feed, subscriptionId, context,
                                                                     selectors, filters);
            } else if (mode === 'w') {
                this._subscriptions[fullId] = new SinkSubscription(feed, subscriptionId, context,
                                                                   selectors, filters);
            } else {
                throw new Error('Invalid mode ' + mode);
            }

            this._subscriptions[fullId].start().done();
        } catch(e) {
            console.log('Failed to handle subscribe: ' + e.message);
            console.log(e.stack);
            feed.sendItem({ op: 'subscribe-error', msg: e.message });
        }
    },

    handleUnsubscribe: function(feed, subscriptionId) {
        var fullId = feed.identifier + '-' + subscriptionId;
        if (!(fullId in this._subscriptions)) {
            console.log('Invalid subscription ' + fullId);
            return;
        }

        this._subscriptions[fullId].stop().done();
        delete this._subscriptions[fullId];
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
        this._feedAddedListener = this._onFeedAdded.bind(this);
        this._feedRemovedListener = this._onFeedRemoved.bind(this);
        this._messaging.on('feed-added', this._feedAddedListener);
        this._messaging.on('feed-removed', this._feedRemovedListener);

        return this._messaging.getFeedList().then(function(feeds) {
            feeds.forEach(function(feedId) {
                this._onFeedAdded(feedId);
            }, this);
        }.bind(this));
    },

    stop: function() {
        this._messaging.removeListener('feed-added', this._feedAddedListener);
        this._messaging.removeListener('feed-removed', this._feedRemovedListener);

        return Q();
    },
});
