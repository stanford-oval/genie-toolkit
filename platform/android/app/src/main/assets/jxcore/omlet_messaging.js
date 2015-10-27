// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const Messaging = require('./engine/messaging');
const Feed = Messaging.Feed;
const FeedCursor = Messaging.FeedCursor;

const JavaAPI = require('./java_api');

const OmletAPI = JavaAPI.makeJavaAPI('OmletAPI',
                                     ['getOwnId',
                                      'createControlFeed',
                                      'getFeedCursor',
                                      'getCursorValue',
                                      'hasNextCursor',
                                      'nextCursor',
                                      'getFeedMembers',
                                      'sendItemOnFeed'],
                                     ['openFeed',
                                      'closeFeed',
                                      'destroyCursor',
                                      'startWatchFeed',
                                      'stopWatchFeed']);

const OmletFeedCursor = new lang.Class({
    Name: 'OmletFeedCursor',
    Extends: FeedCursor,

    _init: function(feed, cursorId) {
        this.parent(feed);
        this._cursorId = cursorId;
    },

    getValue: function() {
        return OmletAPI.getCursorValue(this._cursorId);
    },

    hasNext: function() {
        return OmletAPI.hasNextCursor(this._cursorId);
    },

    next: function() {
        return OmletAPI.nextCursor(this._cursorId);
    },

    destroy: function() {
        return OmletAPI.destroyCursor(this._cursorId);
    },
});

const OmletFeed = new lang.Class({
    Name: 'OmletFeed',
    Extends: Feed,

    _init: function(messaging, feedId) {
        this.parent(feedId);
        this._messaging = messaging;
    },

    open: function() {
        return OmletAPI.openFeed(this.feedId);
    },

    close: function() {
        return OmletAPI.closeFeed(this.feedId);
    },

    getCursor: function() {
        return OmletAPI.getFeedCursor(this.feedId).then(function(cursorId) {
            return new OmletFeedCursor(this, cursorId);
        }.bind(this));
    },

    getMembers: function() {
        return OmletAPI.getFeedMembers(this.feedId);
    },

    startWatch: function() {
        this._messaging._registerWatch(this.feedId, this);
        return OmletAPI.startWatchFeed(this.feedId);
    },

    stopWatch: function() {
        this._messaging._unregisterWatch(this.feedId, this);
        return OmletAPI.stopWatchFeed(this.feedId);
    },

    sendItem: function(item) {
        return OmletAPI.sendItemOnFeed(this.feedId, item);
    },
});

module.exports = new lang.Class({
    Name: 'OmletMessaging',

    _init: function() {
        OmletAPI.registerCallback('onChange', this._onFeedChange.bind(this));

        this._feedWatches = {};
    },

    _onFeedChange: function(error, uri) {
        if (error)
            throw error;

        if (!uri.startsWith('content://mobisocial.osm/feeds/'))
            throw new Error('Invalid Omlet Feed URI ' + uri);

        var id = uri.substr('content://mobisocial.osm/feeds/'.length);
        if (!(id in this._feedWatches))
            return;

        this._feedWatches[id]._onChange();
    },

    _registerWatch: function(feedId, feed) {
        this._feedWatches[feedId] = feed;
    },

    _unregisterWatch: function(feedId, feed) {
        if (this._feedWatches[feedId] !== feed)
            return;
        delete this._feedWatches[feedId];
    },

    createFeed: function() {
        console.log('OmletMessaging.createFeed');
        return OmletAPI.createControlFeed().then(function(uri) {
            if (!uri.startsWith('content://mobisocial.osm/feeds/'))
                throw new Error('Invalid Omlet Feed URI ' + uri);

            console.log('Created Omlet feed at ' + uri);
            return new OmletFeed(this, uri.substr('content://mobisocial.osm/feeds/'.length));
        }.bind(this));
    },

    getOwnId: function() {
        return OmletAPI.getOwnId();
    },

    getFeed: function(feedId) {
        return new OmletFeed(this, feedId);
    }
});
