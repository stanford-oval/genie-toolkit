// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const events = require('events');
const lang = require('lang');
const adt = require('adt');
const deepEqual = require('deep-equal');

const RemoteKeyword = require('./remote_keyword');

const LocalKeyword = new lang.Class({
    Name: 'LocalKeyword',
    Extends: events.EventEmitter,

    _init: function(collection, key) {
        events.EventEmitter.call(this);

        this._collection = collection;
        this.uniqueId = key;
    },

    get value() {
        var doc = this._collection.by('key', this.uniqueId);
        if (doc === undefined)
            return null;
        else
            return doc.value;
    },

    changeValue: function(v) {
        var doc = this._collection.by('key', this.uniqueId);
        if (doc === undefined) {
            if (v !== null) {
                this._collection.insert({ key: this.uniqueId, value: v })
                return true;
            } else {
                return false;
            }
        } else {
            if (v === null) {
                this._collection.remove(doc);
                return true;
            } else if (!deepEqual(doc.value, v, { strict: true })) {
                doc.value = v;
                this._collection.update(doc);
                return true;
            } else {
                return false;
            }
        }
    },

    open: function() {
        return Q();
    },

    close: function() {
        return Q();
    },
});

const LocalKeywordStore = new lang.Class({
    Name: 'LocalKeywordStore',

    _init: function(db) {
        this._db = db;

        this._keywords = [];
        this._listener = this._onEvent.bind(this);
    },

    _onEvent: function(doc) {
        if (this._keywords[doc.key])
            this._keywords[doc.key].emit('changed', null);
    },

    getKeyword: function(key) {
        if (!this._keywords[key])
            this._keywords[key] = new LocalKeyword(this._collection, key);
        return this._keywords[key];
    },

    open: function() {
        this._collection = this._db.getCollection('keywords');
        if (!this._collection)
            this._collection = this._db.addCollection('keywords', { asyncListeners: true });
        this._collection.ensureUniqueIndex('key');

        this._collection.on('insert', this._listener);
        this._collection.on('update', this._listener);
        this._collection.on('delete', this._listener);

        return Q();
    },

    close: function() {
        this._collection.removeListener('insert', this._listener);
        this._collection.removeListener('update', this._listener);
        this._collection.removeListener('delete', this._listener);

        return Q();
    }
});

function makeKey(scope, name, feedId) {
    var key = name;
    if (feedId)
        key += feedId.replace(/[^a-zA-Z0-9]+/g, '-');
    if (scope)
        key = scope + '-' + name;
    else
        key = 'extern-' + name;
    return key;
}

module.exports = new lang.Class({
    Name: 'KeywordRegistry',

    _init: function(db, messaging) {
        this._local = new LocalKeywordStore(db);
        this._messaging = messaging;

        this._keywords = [];
    },

    getKeyword: function(scope, name, feedId, forSelf) {
        var key = makeKey(scope, name, feedId);
        if (!this._keywords[key]) {
            if (feedId)
                this._keywords[key] = new RemoteKeyword(this._messaging, this._local,
                                                        scope, name, feedId, key);
            else
                this._keywords[key] = this._local.getKeyword(key);
        }

        var obj;
        // if we're accessing [SELF], punch through the remote keyword to the
        // corresponding local part
        if (forSelf)
            obj = this._keywords[key].local;
        else
            obj = this._keywords[key];

        return obj.open().then(function() { return obj; });
    },

    start: function() {
        return this._local.open();
    },

    stop: function() {
        return this._local.close();
    },
});
