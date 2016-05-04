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

const TripleStore = require('./triplestore');
const SimpleTripleStore = require('./simpletriplestore');
const OmletStore = require('./omletstore');
const UserStore = OmletStore.User;
const FeedStore = OmletStore.Feed;
const UnionStream = require('./unionstream');

class EmptyStore extends TripleStore {
    constructor(uri) {
        super();
        this._uri = uri;
    }

    get uri() {
        return this._uri;
    }

    get() {
        var stream = new Stream.Readable({ objectMode: true });
        stream.push(null);
        return stream;
    }
}

class UnionStore extends TripleStore {
    constructor(children) {
        super();
        this._children = children;
    }

    ref() {
        this._children.forEach((c) => c.ref());
    }

    unref() {
        this._children.forEach((c) => c.unref());
    }

    get(patterns) {
        var streams = this._children.map((c) => c.get(patterns));
        return new UnionStream(streams);
    }
}

class MeStore extends UnionStore {
    constructor(platform) {
        var local = new SimpleTripleStore(platform.getGraphDB());
        super([local]);
        this.local = local;
    }
}

module.exports = class StoreManager {
    constructor(platform, messaging) {
        this._stores = {};
        this._messaging = messaging;

        this.me = new MeStore(platform);
    }

    getStore(uri) {
        if (this._stores[uri])
            return this._stores[uri];

        var match = uri.match(/^omlet:\/\/me(\/.+)?$/);
        if (match !== null) {
            if (match[1] === null)
                return this.me;
            else // FINISHME
                return new EmptyStore(uri);
        }

        match = uri.match(/^omlet:\/\/user\/([A-Za-z0-9]+)(\/.+)?$/);
        if (match !== null) {
            if (match[1] === this._messaging.account) {
                if (match[2] === null)
                    return this.me;
                else // FINISHME
                    return new EmptyStore(uri);
            } else {
                return this._stores[uri] = new UserStore(this._messaging, match[1], match[2] || '');
            }
        }

        match = uri.match(/^omlet:\/\/feed\/([^/]+)(\/.+)?$/);
        if (match !== null)
            return this._stores[uri] = new FeedStore(this._messaging, match[1], match[2] || '');

        return new EmptyStore(uri);
    }
}
