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

    _onFeedAdded: function(feedId) {
        var messagingDevice = this._messaging.device;
        if (messagingDevice === null)
            return;

        this._devices.loadOneDevice({ kind: 'messaging-group',
                                      feedId: feedId,
                                      messagingDeviceKind: messagingDevice.kind }, false).done();
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

        var groupDevices = this._devices.getAllDevicesOfKind('messaging-group');
        groupDevices.forEach(function(gd) {
            this._devices.removeDevice(gd);
        }, this);

        return Q();
    },
});
