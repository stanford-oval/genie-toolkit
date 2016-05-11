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

const RdfConstants = require('../graphdb/constants');
const RefCounted = require('../util/ref_counted');

class LocalKeyword extends RefCounted {
    constructor(db, name, key) {
        super();

        console.log('Created local keyword ' + name + ' with key ' + key);
        if (!key)
            throw new TypeError('Invalid local keyword key');

        this._db = db;
        this.name = name;
        this.uniqueId = key;
        this._subject = 'urn:x-keyword:' + this.uniqueId;
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
            return this._db.put([{
                subject: this._subject,
                predicate: RdfConstants.RDF_TYPE,
                object: RdfConstants.KEYWORD_CLASS
            }, { subject: this._subject,
                predicate: RdfConstants.HAS_VALUE,
                object: JSON.stringify(this._value)
            }]);
        } else {
            return this._db.delAll({
                subject: this._subject,
                predicate: RdfConstants.HAS_VALUE
            });
        }
    }

    _doOpen() {
        return this._db.getOne({ subject: this._subject,
                                 predicate: RdfConstants.HAS_VALUE,
                                 object: '?value' }).then(function(row) {
            var value;
            if (row === undefined)
                value = null;
            else
                value = JSON.parse(row.value);
            this._value = value;
        }.bind(this));
    }

    _doClose() {
        clearTimeout(this._updateTimeout);
        return this._flushToDisk();
    }
}

module.exports = class LocalKeywordStore {
    constructor(stores) {
        this._db = stores.getStore(RdfConstants.LOCAL);

        this._keywords = {};
    }

    start() {
        this._db.ref();
        return Q();
    }

    stop() {
        this._db.unref();
        return Q();
    }

    getKeyword(name, key) {
        if (!this._keywords[key])
            this._keywords[key] = new LocalKeyword(this._db, name, key);
        return this._keywords[key];
    }
}

