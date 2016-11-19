// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

const LocalKeywordStore = require('./local');

module.exports = class KeywordRegistry {
    constructor(platform) {
        this._local = new LocalKeywordStore(platform);

        this._keywords = {};
    }

    getKeyword(scope, name, feedId, forSelf) {
        var key = scope + '-' + name;
        if (!this._keywords[key])
            this._keywords[key] = this._local.getKeyword(name, key);

        return this._keywords[key];
    }

    getOpenedKeyword(scope, name) {
        var obj = this.getKeyword(scope, name);
        return obj.open().then(function() { return obj; });
    }

    start() {
        return this._local.start();
    }

    stop() {
        return this._local.stop();
    }
}
