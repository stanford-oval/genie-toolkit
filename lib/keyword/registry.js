// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

const RemoteKeyword = require('./remote');
const LocalKeywordStore = require('./local');

function makeKey(scope, name, feedId) {
    var key;

    if (scope) {
        key = scope + '-' + name;

        // we don't need to put the full feedId in the keyword name,
        // it is already implied by the app
        if (feedId)
            key += '-F';
    } else {
        key = 'extern-' + name;

        if (feedId)
            key += feedId.replace(/[^a-zA-Z0-9]+/g, '-');
    }

    return key;
}

module.exports = class KeywordRegistry {
    constructor(stores, messaging) {
        this._local = new LocalKeywordStore(stores);
        this._messaging = messaging;

        this._keywords = {};
    }

    getKeyword(scope, name, feedId, forSelf) {
        var key = makeKey(scope, name, feedId);
        if (!this._keywords[key]) {
            if (feedId)
                this._keywords[key] = new RemoteKeyword(this._messaging, this._local,
                                                        scope, name, feedId, key);
            else
                this._keywords[key] = this._local.getKeyword(name, key);
        }

        var obj;
        // if we're accessing [SELF], punch through the remote keyword to the
        // corresponding local part
        if (forSelf) {
            if (!feedId)
                throw new TypeError();
            obj = this._keywords[key].local;
        } else {
            obj = this._keywords[key];
        }
        return obj;
    }

    getOpenedKeyword(scope, name, feedId, forSelf) {
        var obj = this.getKeyword(scope, name, feedId, forSelf);
        return obj.open().then(function() { return obj; });
    }

    start() {
        return this._local.start();
    }

    stop() {
        return this._local.stop();
    }
}
