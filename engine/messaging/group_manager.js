// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

// This module observes the addition and removal of feeds in the messaging store,
// and ensures that appropriate transient devices are created in the device db
// to represent them
module.exports = new lang.Class({
    Name: 'MessagingGroupManager',

    _init: function(devices, messaging) {
        this._devices = devices;
        this._messaging = messaging;
    },

    _addFeed: function(feedId) {
        var messagingDevice = this._messaging.device;
        if (messagingDevice === null)
            return Q();

        var feed = this._messaging.getFeed(feedId);
        return feed.open().then(function() {
            return feed.getMembers();
        }).then(function(members) {
            // ignore feeds where all members are actually self
            // (a number of which I created in months of debugging, littering
            // my account)
            if (members.every(function(m) { return feed.ownIds.indexOf(m) >= 0; })) {
                console.log('Ignoring feed with only self as member');
                return;
            }

            var state = { kind: 'messaging-group',
                          feedId: feedId,
                          name: feed.name,
                          messagingDeviceKind: messagingDevice.kind };
            var uniqueId = 'messaging-group-' + messagingDevice.kind +
                feedId.replace(/[^a-zA-Z0-9]+/g, '-');
            if (this._devices.hasDevice(uniqueId)) {
                var device = this._devices.getDevice(uniqueId);
                device.updateState(state);
                return Q();
            } else {
                return this._devices.loadOneDevice(state, false);
            }
        }.bind(this)).finally(function() {
            feed.close();
        });
    },

    _onFeedAdded: function(feedId) {
        this._addFeed(feedId).done();
    },

    _onFeedRemoved: function(feedId) {
        var groupDevices = this._devices.getAllDevicesOfKind('messaging-group');

        groupDevices.forEach(function(gd) {
            if (gd.feedId === feedId)
                this._devices.removeDevice(gd);
        }, this);
    },

    start: function() {
        this._feedAddedListener = this._onFeedAdded.bind(this);
        this._feedRemovedListener = this._onFeedRemoved.bind(this);
        this._messaging.on('feed-changed', this._feedAddedListener);

        return this._messaging.getFeedList().then(function(feeds) {
            this._messaging.on('feed-added', this._feedAddedListener);
            this._messaging.on('feed-removed', this._feedRemovedListener);

            return Q.all(feeds.map(function(feedId) {
                return this._addFeed(feedId);
            }, this));
        }.bind(this));
    },

    stop: function() {
        this._messaging.removeListener('feed-added', this._feedAddedListener);
        this._messaging.removeListener('feed-changed', this._feedAddedListener);
        this._messaging.removeListener('feed-removed', this._feedRemovedListener);

        var groupDevices = this._devices.getAllDevicesOfKind('messaging-group');
        groupDevices.forEach(function(gd) {
            this._devices.removeDevice(gd);
        }, this);

        return Q();
    },
});
