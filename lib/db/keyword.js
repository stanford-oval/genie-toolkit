// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');
const adt = require('adt');
const deepEqual = require('deep-equal');

const RefCounted = require('../util/ref_counted');
const RemoteKeyword = require('../remote_keyword');
const sql = require('./sql');

class LocalKeyword extends RefCounted {
    constructor(db, name, key) {
        super();

        console.log('Created local keyword ' + name + ' with key ' + key);
        if (!key)
            throw new TypeError('Invalid local keyword key');

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

        if (this._value !== null)
            return this._db.insertOne(this.uniqueId, {
                value: JSON.stringify(this._value)
            });
        else
            return this._db.deleteOne(this.uniqueId);
    }

    _doOpen() {
        return this._db.getOne(this.uniqueId).then(function(row) {
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

class LocalKeywordStore {
    constructor(platform) {
        this._db = sql.db(platform.getSqliteDB());

        this._keywords = {};
    }

    getKeyword(name, key) {
        if (!this._keywords[key])
            this._keywords[key] = new LocalKeyword(this, name, key);
        return this._keywords[key];
    }

    getAll() {
        return this._db.withClient(function(client) {
            return sql.selectAll(client, 'select uniqueId,value from keyword', []);
        }.bind(this));
    }

    getOne(uniqueId) {
        return this._db.withClient(function(client) {
            return sql.selectOne(client, 'select uniqueId,value from keyword where uniqueId = ?',
                                 [uniqueId]);
        }.bind(this));
    }

    insertOne(uniqueId, row) {
        return this._db.withTransaction(function(client) {
            return sql.insertOne(client, 'insert or replace into keyword(uniqueId, value) values (?,?)',
                                 [uniqueId, row.value]);
        });
    }

    deleteOne(uniqueId) {
        return this._db.withTransaction(function(client) {
            return sql.insertOne(client, 'delete from keyword where uniqueId = ?', [uniqueId]);
        });
    }
}

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
    constructor(platform, messaging) {
        this._local = new LocalKeywordStore(platform);
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
        return Q();
    }

    stop() {
        return Q();
    }
}
