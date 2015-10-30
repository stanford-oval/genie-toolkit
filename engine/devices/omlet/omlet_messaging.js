// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const Messaging = require('../../messaging');
const Feed = Messaging.Feed;
const FeedCursor = Messaging.FeedCursor;

const OmletFeedCursor = new lang.Class({
    Name: 'OmletFeedCursor',
    Extends: FeedCursor,

    _init: function(feed, db) {
        this.parent(feed);

        this._db = db;
        this._data = db._data.find();
        this._idx = 0;
        this._client = this.feed._device.refOmletClient();
    },

    getValue: function() {
        return this._data[this._idx];
    },

    hasNext: function() {
        return this._idx < this._data.length;
    },

    next: function() {
        return this._data[this._idx++];
    },

    destroy: function() {
        this.feed._device.unrefOmletClient();
        this._client = null;
    },
});

const OmletFeed = new lang.Class({
    Name: 'OmletFeed',
    Extends: Feed,

    _init: function(messaging, feedId) {
        this.parent(feedId);
        this._messaging = messaging;
        this._device = messaging._device;
        this._client = null;
        this._watch = null;
        this._feed = null;
    },

    open: function() {
        this._client = this._device.refOmletClient();
        return Q();
    },

    close: function() {
        this._device.unrefOmletClient();
        this._client = null;
        return Q();
    },

    getCursor: function() {
        return Q.ninvoke(this._client, 'getFeedObjects', this.feedId).then(function(db) {
            return new OmletFeedCursor(this, db);
        }.bind(this));
    },

    _getFeed: function() {
        if (this._feed !== null)
            return Q(this._feed);
        else
            return Q.ninvoke(this._client, 'getFeeds').then(function(db) {
                return Q.ninvoke(db, 'getObjectById', this.feedId);
            }.bind(this)).then(function(o) {
                this._feed = o;
                return o;
            }.bind(this));
    },

    getMembers: function() {
        return this._getFeed().then(function(o) {
            return o.members;
        });
    },

    _onChange: function() {
        this.emit('changed');
    },

    startWatch: function() {
        this._watch = this._client.events.register(this._client.events.FEEDS, this._onChange.bind(this));
    },

    stopWatch: function() {
        this._watch();
        this._watch = null;
    },

    sendItem: function(item) {
        return this._getFeed().then(function(feed) {
            return Q.ninvoke(this._client.messaging, '_sendObjToFeed', feed, 'text', JSON.stringify(item));
        });
    },
});

module.exports = new lang.Class({
    Name: 'OmletMessaging',

    _init: function(device) {
        this._device = device;
        this._feedWatches = {};

        this._syncclient = null;
    },

    startSync: function() {
        this._syncclient = this._device.refOmletClient();
    },

    stopSync: function() {
        this._device.unrefOmletClient();
        this._syncclient = null;
    },

    createFeed: function() {
        console.log('OmletMessaging.createFeed');

        var client = this._device.refOmletClient();
        return Q.ninvoke(client.feed, 'createFeed').then(function(feed) {
            return new OmletFeed(this, client.store.getObjectId(feed));
        }.bind(this)).finally(function() {
            this._device.unrefOmletClient();
        }.bind(this));
    },

    getFeed: function(feedId) {
        return new OmletFeed(this, feedId);
    }
});
