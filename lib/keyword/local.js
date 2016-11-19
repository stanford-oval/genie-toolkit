// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const deepEqual = require('deep-equal');

const RefCounted = require('../util/ref_counted');
const KeywordSql = require('../db/keyword');

class LocalKeyword extends RefCounted {
    constructor(db, name, key) {
        super();

        if (!key)
            throw new TypeError('Invalid local keyword key');
        console.log('Created local keyword ' + name + ' with key ' + key);

        this._db = db;
        this.name = name;
        this.uniqueId = key;
        this.dirty = false;

        this._value = null;

        this._updateTimeout = null;
    }

    get value() {
        return this._value;
    }

    changeValue(v) {
        if (v === undefined)
            throw new Error('Invalid keyword value undefined');

        if (deepEqual(this._value, v, { strict: true }))
            return false;

        this._value = v;

        clearTimeout(this._updateTimeout);
        this._updateTimeout = setTimeout(this._flushToDisk.bind(this), 500);

        if (this.dirty)
            return true;
        this.dirty = true;
        setImmediate(function() {
            this.dirty = false;
            this.emit('changed', null);
        }.bind(this));
        return true;
    }

    _flushToDisk() {
        this._updateTimeout = null;

        if (this._value !== null) {
            return this._db.insertOne(this.uniqueId, this._value);
        } else {
            return this._db.deleteOne(this.uniqueId);
        }
    }

    _doOpen() {
        return this._db.getOne(this.uniqueId).then(function(value) {
            this._value = value;
        }.bind(this));
    }

    _doClose() {
        clearTimeout(this._updateTimeout);
        return this._flushToDisk();
    }
}

module.exports = class LocalKeywordStore {
    constructor(platform) {
        this._db = new KeywordSql(platform);

        this._keywords = {};
    }

    start() {
        return Q();
    }

    stop() {
        return Q();
    }

    getKeyword(name, key) {
        if (!this._keywords[key])
            this._keywords[key] = new LocalKeyword(this._db, name, key);
        return this._keywords[key];
    }
}

