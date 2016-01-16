// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');
const Tp = require('thingpedia');

// This module observes the addition and removal of messaging devices,
// and controls the lifetime of additional modules that depend on
// a specific messaging device

// It also provides an implementation of the Messaging interface
// based on whatever is the current device
// (which fails with Error('Device Not Available') if there is no
// configured messaging device
module.exports = new lang.Class({
    Name: 'MessagingDeviceManager',
    Extends: Tp.Messaging,

    _init: function(devices) {
        this._devices = devices;
        this._messagingDevice = null;
        this._messagingIface = null;

        this._syncing = false;

        this._feedAddedListener = this._onFeedAdded.bind(this);
        this._feedRemovedListener = this._onFeedRemoved.bind(this);
        this._feedChangedListener = this._onFeedChanged.bind(this);
    },

    get device() {
        return this._messagingDevice;
    },

    get isAvailable() {
        return this._messagingIface !== null;
    },

    _checkAvailable: function() {
        if (this._messagingIface === null)
            throw new Error('Device Not Available');
    },

    startSync: function() {
        this._syncing = true;
        if (this._messagingIface !== null)
            this._messagingIface.startSync();
    },

    stopSync: function() {
        this._syncing = false;
        if (this._messagingIface !== null)
            this._messagingIface.stopSync();
    },

    getOwnId: function() {
        this._checkAvailable();
        return this._messagingIface.getOwnId();
    },

    getUserById: function(id) {
        this._checkAvailable();
        return this._messagingIface.getUserById(id);
    },

    getAccountById: function(id) {
        this._checkAvailable();
        return this._messagingIface.getAccountById(id);
    },

    getFeedList: function() {
        if (this._messagingIface === null)
            return Q([]);
        else
            return this._messagingIface.getFeedList();
    },

    getFeedMetas: function() {
        if (this._messagingIface === null)
            return Q([]);
        else
            return this._messagingIface.getFeedMetas();
    },

    getFeed: function(feedId) {
        this._checkAvailable();
        return this._messagingIface.getFeed(feedId);
    },

    createFeed: function() {
        this._checkAvailable();
        return this._messagingIface.createFeed();
    },

    getFeedWithContact: function(contactId) {
        this._checkAvailable();
        return this._messagingIface.getFeedWithContact(contactId);
    },

    _onFeedAdded: function(feed) {
        this.emit('feed-added', feed);
    },

    _onFeedRemoved: function(feed) {
        this.emit('feed-removed', feed);
    },

    _onFeedChanged: function(feed) {
        this.emit('feed-changed', feed);
    },

    _tryAddMessagingDevice: function(device) {
        this._messagingDevice = device;
        var iface = device.queryInterface('messaging');

        console.log('Found Messaging Device ' + device.uniqueId);

        return iface.getFeedList().then(function(feeds) {
            this._messagingIface = iface;

            iface.on('feed-added', this._feedAddedListener);
            iface.on('feed-removed', this._feedRemovedListener);
            iface.on('feed-changed', this._feedChangedListener);

            feeds.forEach(function(feedId) {
                this.emit('feed-added', feedId);
            }, this);

            if (this._syncing)
                iface.startSync();
        }.bind(this));
    },

    _closeMessagingDevice: function() {
        this._messagingIface.removeListener('feed-added', this._feedAddedListener);
        this._messagingIface.removeListener('feed-removed', this._feedRemovedListener);
        this._messagingIface.removeListener('feed-changed', this._feedChangedListener);

        console.log('Lost Messaging Device ' + this._messagingDevice.uniqueId);

        if (this._syncing)
            this._messagingIface.stopSync();

        this._messagingIface.getFeedList().then(function(feeds) {
            feeds.forEach(function(feedId) {
                this.emit('feed-removed', feedId);
            }, this);
        }.bind(this)).done();
    },

    _tryFindMessagingDevice: function() {
        var messagingDevices = this._devices.getAllDevicesOfKind('messaging');
        if (messagingDevices.length == 0)
            return Q();
        return this._tryAddMessagingDevice(messagingDevices[0]);
    },

    _onDeviceAdded: function(device) {
        if (this._messagingDevice !== null)
            return;
        if (!device.hasKind('messaging'))
            return;

        this._tryAddMessagingDevice(device).done();
    },

    _onDeviceRemoved: function(device) {
        if (this._messagingDevice !== device)
            return;

        this._closeMessagingDevice();
        this._messagingIface = null;
        this._messagingDevice = null;
        this._tryFindMessagingDevice().done();
    },

    start: function() {
        this._deviceAddedListener = this._onDeviceAdded.bind(this);
        this._deviceRemovedListener = this._onDeviceRemoved.bind(this);
        this._devices.on('device-added', this._deviceAddedListener);
        this._devices.on('device-removed', this._deviceRemovedListener);

        return this._tryFindMessagingDevice();
    },

    stop: function() {
        this._devices.removeListener('device-added', this._deviceAddedListener);
        this._devices.removeListener('device-removed', this._deviceRemovedListener);
        this._deviceAddedListener = null;
        this._deviceRemovedListener = null;
        return Q();
    },
});
