// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const Messaging = require('../../messaging/iface');
const Feed = Messaging.Feed;
const FeedCursor = Messaging.FeedCursor;

const OmletFeedCursor = new lang.Class({
    Name: 'OmletFeedCursor',
    Extends: FeedCursor,

    _init: function(feed, db) {
        this.parent(feed);

        this._db = db;
        this._data = db._data.chain().simplesort('serverTimestamp', true).data();
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

function oinvoke(object, method) {
    var args = Array.prototype.slice.call(arguments, 2);

    return Q.Promise(function(callback, errback) {
        args.push(callback);
        return object[method].apply(object, args);
    });
}

const OmletFeed = new lang.Class({
    Name: 'OmletFeed',
    Extends: Feed,

    _init: function(messaging, feedId) {
        this.parent(feedId);
        this._messaging = messaging;
        this._device = messaging._device;
        this._client = null;
        this._insertListener = null;
        this._db = null;
        this._feed = null;
        this._ownIds = [];
    },

    _onInsert: function(o) {
        this.emit('new-message', o);
        if (this._ownIds.indexOf(msg.senderId) < 0)
            this.emit('incoming-message', o);
        else
            this.emit('outgoing-message', o);
    },

    open: function() {
        this._client = this._device.refOmletClient();

        return this._messaging.getOwnIds().then(function(ownIds) {
            this._ownIds = ownIds;
            return this._getFeed();
        }).then(function(o) {
            return oinvoke(this._client.store, 'getFeedObjects', this._client.store.getObjectId(o));
        }.bind(this)).then(function(db) {
            this._db = db;
            this._db._data.on('insert', this._insertListener);
        }.bind(this));
    },

    close: function() {
        this._device.unrefOmletClient();
        this._client = null;

        if (this._insertListener)
            this._db._data.removeListener('insert', this._insertListener);
        this._insertListener = null;
        return Q();
    },

    getCursor: function() {
        return new OmletFeedCursor(this, this._db);
    },

    _getFeed: function() {
        if (this._feed !== null)
            return Q(this._feed);
        else
            return oinvoke(this._client.store, 'getFeeds').then(function(db) {
                return oinvoke(db, 'getObjectByKey', this.feedId);
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

    sendItem: function(item) {
        return this._getFeed().then(function(feed) {
            return Q.ninvoke(this._client.messaging, '_sendObjToFeed', feed, 'text', JSON.stringify(item));
        });
    },
});

module.exports = new lang.Class({
    Name: 'OmletMessaging',
    Extends: Messaging,

    _init: function(device) {
        this._device = device;
        this._feedWatches = {};

        this._syncclient = null;
    },

    _onFeedAdded: function(o) {
        this.emit('feed-added', o.identifier);
    },

    _onFeedRemoved: function(o) {
        this.emit('feed-removed', o.identifier);
    },

    startSync: function() {
        this._syncclient = this._device.refOmletClient();

        oinvoke(this._syncclient.store, 'getFeeds').then(function(db) {
            this._feedAddedListener = this._onFeedAdded.bind(this);
            this._feedRemovedListener = this._onFeedRemoved.bind(this);
            db._data.on('insert', this._feedAddedListener);
            db._data.on('delete', this._feedRemovedListener);
        }.bind(this)).done();
    },

    stopSync: function() {
        oinvoke(this._syncclient.store, 'getFeeds').then(function(db) {
            db._data.removeListener('insert', this._feedAddedListener);
            db._data.removeListener('delete', this._feedRemovedListener);
        }.bind(this)).done();

        this._device.unrefOmletClient();
        this._syncclient = null;
    },

    getOwnIds: function() {
        var client = this._device.refOmletClient();
        return oinvoke(client.store, 'getAccounts').then(function(db) {
            return db._data.find({ owned: true }).map(function(o) {
                return client.store.getObjectId(o);
            });
        }).finally(function() {
            this._device.unrefOmletClient();
        }.bind(this));
    },

    getAccountById: function(id) {
        var client = this._device.refOmletClient();
        return oinvoke(client.store, 'getAccounts').then(function(db) {
            return oinvoke(db, 'getObjectById', id).then(function(o) {
                return o.account;
            });
        }).finally(function() {
            this._device.unrefOmletClient();
        }.bind(this));
    },

    getFeedList: function() {
        console.log('OmletMessaging.getFeedList');

        var client = this._device.refOmletClient();
        return oinvoke(client.store, 'getFeeds').then(function(db) {
            var data = db._data.find();
            return data.map(function(d) {
                return d.identifier;
            });
        }).finally(function() {
            this._device.unrefOmletClient();
        }.bind(this));
    },

    createFeed: function() {
        console.log('OmletMessaging.createFeed');

        var client = this._device.refOmletClient();
        return oinvoke(client.feed, 'createFeed').then(function(feed) {
            return new OmletFeed(this, feed.identifier);
        }.bind(this)).finally(function() {
            this._device.unrefOmletClient();
        }.bind(this));
    },

    getFeed: function(feedId) {
        return new OmletFeed(this, feedId);
    },

    getFeedWithContact: function(contactId) {
        console.log('OmletMessaging.getFeedWithContact');

        var client = this._device.refOmletClient();
        return oinvoke(client.feed, 'getOrCreateFeedWithMembers', [contactId]).then(function(feed) {
            return new OmletFeed(this, feed.identifier);
        }.bind(this)).finally(function() {
            this._device.unrefOmletClient();
        }.bind(this));
    },
});
