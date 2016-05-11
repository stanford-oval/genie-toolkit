// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of DataShare
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const Stream = require('stream');

const Config = require('../config');
const RdfConstants = require('../graphdb/constants');
const SelectRunner = require('../graphdb/selectrunner');

const BATCH_SIZE = 20;

class RequestHandler {
    constructor(stores, from, target, targetRest, requestId, patterns, feed) {
        this._from = from;
        this._target = target;
        this._requestId = requestId;

        var subjects = new Set();

        // enforce the existance of a permission on all subjects referenced
        // in the query
        patterns.forEach((p) => subjects.add(p.subject));
        subjects.forEach((s) => {
            patterns.push({
                subject: s,
                predicate: RdfConstants.HAS_PERMISSION,
                object: from
            });
        });

        this._patterns = patterns;
        this._feed = feed;

        var meUri = Config.RDF_BASE + 'me' + targetRest;
        var runner = new SelectRunner(stores, { type: 'query', queryType: 'select',
                                                from: { default: [meUri] },
                                                where: patterns });
        this._stream = runner.run();

        this._stream.on('error', (e) => {
            if (this._ended)
                return;
            this._ended = true;

            this._sendMsg('solution-end', e.message);
        });

        this._batch = [];
        this._stream.on('data', (data) => {
            if (this._ended)
                return;
            this._batch.push(data);
            if (this._batch.length >= BATCH_SIZE)
                this._flushBatch();
        });

        this._stream.on('end', (data) => {
            if (this._ended)
                return;
            this._ended = true;

            this._flushBatch();
            this._sendMsg('solution-end');
        });
    }

    _sendMsg(op, data, error) {
        var msg = { version: 1, ns: Config.RDF_BASE,
                    op: op,
                    from: this._target,
                    target: this._from,
                    id: this._requestId };
        if (data)
            msg.data = data;
        if (error)
            msg.error = error;
        this._feed.sendItem(msg);
    }

    _flushBatch() {
        var batch = this._batch;
        this._batch = [];

        this._sendMsg('solution-data', null, batch);
    }
}

class ResponderFeed {
    constructor(db, messaging, feed) {
        this._db = db;
        this._messaging = messaging;
        this._feed = feed;

        this._feedUri = Config.RDF_BASE + 'feed/' + encodeURIComponent(feed.feedId);
        this._userUri = Config.RDF_BASE + 'user/' + messaging.account;

        this._incomingMessageListener = this._onIncomingMessage.bind(this);
    }

    _onIncomingMessage(message) {
        if (!message.text || !message.hidden)
            return;

        try {
            var parsed = JSON.parse(msg.text);
        } catch(e) {
            return;
        }

        if (parsed.version !== 1 || parsed.ns !== Config.RDF_BASE)
            return;
        if (parsed.op !== 'select')
            return;

        var rest;
        if (parsed.target.startsWith(this._feedUri))
            rest = parsed.target.substr(this._feedUri.length);
        else if (parsed.target.startsWith(this._userUri))
            rest = parsed.target.substr(this._userUri.length);
        else // ignore
            return;

        new RequestHandler(this._db, parsed.from, parsed.target, rest, parsed.id, parsed.patterns, this._feed);
    }

    start() {
        this._feed.on('incoming-message', this._incomingMessageListener);
        return this._feed.open();
    }

    stop() {
        this._feed.removeListener('incoming-message', this._incomingMessageListener);
        return this._feed.close();
    }
}



module.exports = class OmletResponder {
    constructor(db, messaging) {
        this._db = db;
        this._messaging = messaging;

        this._feeds = {};

        this._feedAddedListener = this._onFeedAdded.bind(this);
        this._feedRemovedListener = this._onFeedRemoved.bind(this);
    }

    _onFeedAdded(feedId) {
        this._feeds[feedId] = new ResponderFeed(this._db, this._messaging,
                                                this._messaging.getFeed(feedId));
        this._feeds[feedId].start().done();
    }

    _onFeedRemoved(feedId) {
        var feed = this._feeds[feedId];
        delete this._feeds[feedId];
        if (feed)
            feed.stop().done();
    }

    start() {
        return this._messaging.getFeedList().then((feeds) => {
            this._messaging.on('feed-added', this._feedAddedListener);
            this._messaging.on('feed-removed', this._feedRemovedListener);

            feeds.forEach(this._onFeedAdded, this);
        });
    }

    stop() {
        this._messaging.removeListener('feed-added', this._feedAddedListener);
        this._messaging.removeListener('feed-removed', this._feedRemovedListener);

        for (var feedId in this._feeds)
            this._feeds[feedId].stop().done();

        return Q();
    }
}
