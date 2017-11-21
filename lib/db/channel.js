// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

const sql = require('./sqlite');
const RefCounted = require('../util/ref_counted');

module.exports = class ChannelStateBinder extends RefCounted {
    constructor(platform) {
        super();
        this._db = sql.db(platform.getSqliteDB(), platform.getSqliteKey());
        this._cached = {};
        this.uniqueId = null;
        this._updateTimeout = null;
    }

    init(uniqueId) {
        this.uniqueId = uniqueId;
    }

    get(name) {
        return this._cached[name];
    }

    set(name, value) {
        this._cached[name] = value;
        this.changed();
    }

    durableSet(name, value) {
        this._cached[name] = value;

        clearTimeout(this._updateTimeout);
        return this.flushToDisk();
    }

    changed() {
        clearTimeout(this._updateTimeout);
        this._updateTimeout = setTimeout(this.flushToDisk.bind(this), 500);
    }

    flushToDisk() {
        if (!this._updateTimeout)
            return Q();
        this._updateTimeout = null;

        return this._db.withTransaction((dbClient) => {
            let valueStr = JSON.stringify(this._cached);
            if (valueStr === '{}')
                return sql.drop(dbClient, "delete from channel where uniqueId = ?", [this.uniqueId]);
            else
                return sql.insertOne(dbClient, "insert or replace into channel(uniqueId, value) values (?, ?)", [this.uniqueId, valueStr]);
        });
    }

    _doOpen() {
        return this._db.withTransaction((dbClient) => {
            return sql.selectOne(dbClient, "select value from channel where uniqueId = ?", [this.uniqueId]).then((row) => {
                if (row === undefined)
                    this._cached = {};
                else
                    this._cached = JSON.parse(row.value) || {};
            });
        });
    }

    _doClose() {
        clearTimeout(this._updateTimeout);
        return this.flushToDisk();
    }
}
