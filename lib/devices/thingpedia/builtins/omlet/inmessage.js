// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//                Jiwon Seo <jiwon@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const events = require('events');
const Tp = require('thingpedia');

class FeedMessageChannel extends events.EventEmitter {
    constructor(feed, device, signal) {
        super();

        this._feed = feed;
        this.device = device;
        this.signal = signal;

        this._listener = this._onMsg.bind(this);
    }

    open() {
        return this._feed.open().then(function() {
            this._feed.on(this.signal, this._listener);
        }.bind(this));
    }

    close() {
        this._feed.removeListener(this.signal, this._listener);
        return this._feed.close();
    }

    _onMsg(msg) {
        if (msg.hidden)
            return;
        //console.log('Received message', msg);

        if (msg.type === 'picture') {
            var blob = this.device._omletClient._ldClient.blob;

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
    }
}

class AllFeedsChannel extends events.EventEmitter {
    constructor(engine, device, signal) {
        super();

        this._messaging = engine.messaging;
        this.device = device;
        this.signal = signal;

        this._feeds = {};
    }

    _onMsg(event) {
        this.emit('event', event);
    }

    _onFeedAdded(feedId) {
        var channel = new FeedMessageChannel(this._messaging.getFeed(feedId), this.device, this.signal);
        channel.on('event', this._onMsg.bind(this));

        this._feeds[feedId] = channel;
        channel.open().done();
    }

    _onFeedRemoved(feedId) {
        var channel = this._feeds[feedId];
        delete this._feeds[feedId];
        channel.close().done();
    }

    open() {
        this._feedAddedListener = this._onFeedAdded.bind(this);
        this._feedRemovedListener = this._onFeedRemoved.bind(this);
        this._messaging.on('feed-added', this._feedAddedListener);
        this._messaging.on('feed-removed', this._feedRemovedListener);

        return this._messaging.getFeedList().then(function(feeds) {
            feeds.forEach(function(feedId) {
                this._onFeedAdded(feedId);
            }, this);
        }.bind(this));
    }

    close() {
        this._messaging.removeListener('feed-added', this._feedAddedListener);
        this._messaging.removeListener('feed-removed', this._feedRemovedListener);
        for (var feedId in this._feeds)
            this._onFeedRemoved(feedId);
        this._feeds = {};
    }
}

module.exports = class InMessageChannel extends Tp.BaseChannel {
    constructor(engine, device, params) {
        super(engine, device);
        this.engine = engine;
        this.device = device;

        this._feed = params[0];
        if (this._feed !== undefined) {
            this.filterString = 'feed-' + this._feed.feedId.replace(/[^a-zA-Z0-9]+/g, '-');
            this._channel = new FeedMessageChannel(this._feed, this.device, this.signal);
        } else {
            this._channel = new AllFeedsChannel(this.engine, this.device, this.signal);
        }

        this._channel.on('event', this._onEvent.bind(this));
    }

    _onEvent(event) {
        this.emitEvent(event);
    }

    _doOpen() {
        return this._channel.open();
    }

    _doClose() {
        return this._channel.close();
    }
}
