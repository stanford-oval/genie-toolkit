// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

const prefs = require('./util/prefs');

module.exports = class Statistics {
    constructor(platform) {
        this._platform = platform;
        this._file = platform.getWritableDir() + '/stats.db';
    }

    start() {
        // flush at most every 10s, because we don't care if we lose stats in
        // case of a crash, and this gets hit often
        this._prefs = new prefs.FilePreferences(this._file, 10000);
        return Q();
    }

    stop() {
        return this._prefs.flush();
    }

    snapshot() {
        if (!this._prefs)
            return;
        return this._prefs.saveCopy(platform.getWritableDir() + '/stats-snapshot.' + ((new Date).toISOString()));
    }

    keys() {
        if (!this._prefs)
            return [];
        return this._prefs.keys();
    }

    set(key, value) {
        if (!this._prefs)
            return;
        return this._prefs.set(key, value);
    }

    get(key) {
        if (!this._prefs)
            return;
        return this._prefs.get(key);
    }

    hit(key) {
        if (!this._prefs)
            return;
        var old = this._prefs.get(key);
        if (old === undefined)
            old = 0;
        this._prefs.set(key, old+1);
    }
};
