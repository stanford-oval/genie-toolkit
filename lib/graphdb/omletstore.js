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
const crypto = require('crypto');
const Tp = require('thingpedia');
const TripleStore = Tp.TripleStore;

const Config = require('../config');

function makeId(serial) {
    var hash = crypto.createHash('md5');
    hash.update(String(serial));
    return hash.digest('hex').substring(0, 8);
}

class OmletStore extends TripleStore {
    constructor(messaging) {
        super();
        this._messaging = messaging;

        this._feed = null;
        this._refcount = 0;
        this._id = 0;

        this._inflight = {};

        this._incomingMessageListener = this._onIncomingMessage.bind(this);
    }

    ref() {
        this._refcount ++;
        return this;
    }

    unref() {
        if (--this._refcount > 0)
            return;

        if (this._feed) {
            this._feed.removeListener(this._incomingMessageListener);
            this._feed.close().done();
        }
        this._feed = null;
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
        if (parsed.op !== 'solution-data' && parsed.op !== 'solution-end')
            return;
        if (parsed.target !== Config.RDF_BASE + 'user/' + this._messaging.account ||
            parsed.from !== this.uri)
            return;
        var id = parsed.id;

        var stream = this._inflight[id];
        if (!stream)
            return;

        if (parsed.error) {
            stream.emit('error', new Error(parsed.error));
            return;
        }

        if (parsed.op === 'solution-data') {
            parsed.data.forEach((data) => stream.push(data));
        } else {
            stream.push(null);
            delete this._inflight[id];
        }
    }

    _ensureFeed() {
        if (this._feed)
            return Q(this._feed);

        return this._getFeed().then((feed) => {
            this._feed = feed;
            if (this._refcount > 0) {
                this._feed.on('incoming-message', this._incomingMessageListener);
                return feed.open();
            }
        });
    }

    get(patterns) {
        var stream = new Stream.Readable({ objectMode: true, read: function() {} });
        var id = makeId(this._id++);
        this._inflight[id] = stream;
        this._getFeed().then((feed) => {
            feed.sendItem({ version: 1, op: 'select', ns: Config.RDF_BASE,
                            from: Config.RDF_BASE + 'user/' + this._messaging.account,
                            target: this.uri,
                            id: id, patterns: patterns });
        }).catch((e) => stream.emit('error', e));

        return stream;
    }

    put() {
        throw new Error('Operation Not Permitted');
    }
}

class UserStore extends OmletStore {
    constructor(messaging, user) {
        super(messaging);

        this._user = user;
    }

    get uri() {
        return 'omlet://user/' + this._user;
    }

    _getFeed() {
        return this._messaging.getFeedWithContact(this._user);
    }
}

class FeedStore extends OmletStore {
    constructor(messaging, feedId) {
        super(messaging);

        this._feedId = decodeURIComponent(feedId);
    }

    get uri() {
        return 'omlet://feed/' + encodeURIComponent(this._feedId);
    }

    _getFeed() {
        return this._messaging.getFeed(this._feedId);
    }
}

module.exports = {
    User: UserStore,
    Feed: FeedStore
}
