// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//                Jiwon Seo <jiwon@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const events = require('events');
const Tp = require('thingpedia');

const FeedMessageChannel = new lang.Class({
    Name: 'FeedMessageChannel',
    Extends: events.EventEmitter,

    _init: function(feed, signal) {
        events.EventEmitter.call(this);

        this._feed = feed;
        this.signal = signal;

        this._listener = this._onMsg.bind(this);
    },

    open: function() {
        return this._feed.open().then(function() {
            this._feed.on(this.signal, this._listener);
        }.bind(this));
    },

    close: function() {
        this._feed.removeListener(this.signal, this._listener);
        return this._feed.close();
    },

    _onMsg: function(msg) {
        if (msg.hidden)
            return;
        //console.log('Received message', msg);

        if (msg.type === 'picture') {
            var blob = this.device.omletClient.blob;

            setTimeout(function() {
                blob.getDownloadLinkForHash(msg.fullSizeHash, function(error, url) {
                    if (error) {
                        console.log('failed to get download link for picture', error);
                        return;
                    }

                    this.emit('event', [this._feed, 'picture', url]);
                }.bind(this));
            }.bind(this), 5000);
        } else if (msg.type === 'text') {
            this.emit('event', [this._feed, 'text', msg.text]);
        }
    },
});

const AllFeedsChannel = new lang.Class({
    Name: 'AllFeedsChannel',
    Extends: events.EventEmitter,

    _init: function(engine, signal) {
        this._messaging = engine.messaging;
        this.signal = signal;

        this._feeds = {};
    },

    _onMsg: function(event) {
        this.emit('event', event);
    },

    _onFeedAdded: function(feedId) {
        var channel = new FeedMessageChannel(this._messaging.getFeed(feedId), this.signal);
        channel.on('event', this._onMsg.bind(this));

        this._feeds[feedId] = channel;
        channel.open().done();
    },

    _onFeedRemoved: function(feedId) {
        var channel = this._feeds[feedId];
        delete this._feeds[feedId];
        channel.close().done();
    },

    open: function() {
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

    close: function() {
        this._messaging.removeListener('feed-added', this._feedAddedListener);
        this._messaging.removeListener('feed-removed', this._feedRemovedListener);
        for (var feedId in this._feeds)
            this._onFeedRemoved(feedId);
        this._feeds = {};
    }
});

module.exports = new lang.Class({
    Name: 'InMessageChannel',
    Extends: Tp.BaseChannel,

    _init: function(engine, device, params) {
        this.parent();
        this.engine = engine;
        this.device = device;

        if (params.length >= 1) {
            if (!params[0].isFeed)
                throw new Error('Invalid @omlet.[new,incoming]message() parameters');

            this._feed = params[0].value;
            this.filterString = 'feed-' + this._feed.feedId.replace(/[^a-zA-Z0-9]+/g, '-');
            this._channel = new FeedMessageChannel(this._feed, this.signal);
        } else {
            this._channel = new AllFeedsChannel(this.engine, this.signal);
        }

        this._channel.on('event', this._onEvent.bind(this));
    },

    _onEvent: function(event) {
        this.emitEvent(event);
    },

    _doOpen: function() {
        return this._channel.open();
    },

    _doClose: function() {
        return this._channel.close();
    }
});
