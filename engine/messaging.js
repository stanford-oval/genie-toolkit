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

    startWatch: function() {
        throw new Error('Not Implemented');
    },

    stopWatch: function() {
        throw new Error('Not Implemented');
    },

    sendItem: function() {
        throw new Error('Not Implemented');
    },
});

module.exports = new lang.Class({
    Name: 'Messaging',

    _init: function() {
    },

    getOwnId: function() {
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
