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

const RefCounted = require('./ref_counted');

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

const MessagingUser = new lang.Class({
    Name: 'MessagingUser',
    Abstract: true,

    _init: function() {
        this.id = undefined;
        this.account = undefined;
        this.name = undefined;
    }
});

const MessagingFeed = new lang.Class({
    Name: 'MessagingFeed',
    Extends: RefCounted,
    // events: new-message, members-changed
    Abstract: true,

    _init: function(feedId) {
        this.parent();

        this.feedId = feedId;
    },

    _doOpen: function() {
        throw new Error('Not Implemented');
    },

    _doClose: function() {
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
    $rpcMethods: ['get isAvailable', 'getOwnId', 'getUserById', 'getAccountById',
                  'getFeedMetas'],

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

    getOwnId: function() {
        throw new Error('Not Implemented');
    },

    getUserById: function() {
        throw new Error('Not Implemented');
    },

    getAccountById: function() {
        throw new Error('Not Implemented');
    },

    getFeedList: function() {
        throw new Error('Not Implemented');
    },

    getFeedMetas: function() {
        throw new Error('Not Implemented');
    },

    getFeed: function(feedId) {
        throw new Error('Not Implemented');
    },

    createFeed: function() {
        throw new Error('Not Implemented');
    },

    getFeedWithContact: function(contactId) {
        throw new Error('Not Implemented');
    },
});
module.exports.Feed = MessagingFeed;
module.exports.FeedCursor = MessagingFeedCursor;
