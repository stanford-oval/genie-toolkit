// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const events = require('events');
const Q = require('q');

const MessagingFeedCursor = new lang.Class({
    Name: 'MessagingFeedCursor',
    Abstract: true,

    _init: function(feed) {
        this.feed = feed;
    },

    getValue: function() {
        throw new Error('Not Implemented');
    },

    hasNext: function() {
        throw new Error('Not Implemented');
    },

    next: function() {
        throw new Error('Not Implemented');
    },

    destroy: function() {
        throw new Error('Not Implemented');
    },
});

const MessagingFeed = new lang.Class({
    Name: 'MessagingFeed',
    Extends: events.EventEmitter,
    // events: new-message
    Abstract: true,

    _init: function(feedId) {
        events.EventEmitter.call(this);

        this.feedId = feedId;
    },

    open: function() {
        throw new Error('Not Implemented');
    },

    close: function() {
        throw new Error('Not Implemented');
    },

    getCursor: function() {
        throw new Error('Not Implemented');
    },

    getMembers: function() {
        throw new Error('Not Implemented');
    },

    sendItem: function() {
        throw new Error('Not Implemented');
    },
});

module.exports = new lang.Class({
    Name: 'Messaging',
    Extends: events.EventEmitter,
    // events: feed-added, feed-removed
    Abstract: true,

    _init: function() {
    },

    get isAvailable() {
        return false;
    },

    startSync: function() {
        throw new Error('Not Implemented');
    },

    stopSync: function() {
        throw new Error('Not Implemented');
    },

    getOwnIds: function() {
        throw new Error('Not Implemented');
    },

    getAccountById: function() {
        throw new Error('Not Implemented');
    },

    getFeedList: function() {
        throw new Error('Not Implemented');
    },

    getFeed: function(feedId) {
        throw new Error('Not Implemented');
    },

    createFeed: function() {
        throw new Error('Not Implemented');
    },
});
module.exports.Feed = MessagingFeed;
module.exports.FeedCursor = MessagingFeedCursor;
