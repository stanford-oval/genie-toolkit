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

const sql = require('./sqlite');
const RefCounted = require('../util/ref_counted');

class ChannelState {
    constructor(platform, uniqueId) {
        this._db = sql.db(platform.getSqliteDB(), platform.getSqliteKey());
        this.uniqueId = uniqueId;

        this._cached = null;
    }

    read() {
        if (this._cached !== null)
            return this._cached;

        return this._cached = this._db.withTransaction((dbClient) => {
            return sql.selectOne(dbClient, "select value from channel where uniqueId = ?", [this.uniqueId]).then((row) => {
                if (row === undefined)
                    return null;
                else
                    return JSON.parse(row.value) || null;
            });
        });
    }

    write(value) {
        this._cached = Promise.resolve(value);

        return this._db.withTransaction((dbClient) => {
            let valueStr = JSON.stringify(value);
            if (valueStr === 'null' || valueStr === '{}')
                return sql.drop(dbClient, "delete from channel where uniqueId = ?", [this.uniqueId]);
            else
                return sql.insertOne(dbClient, "insert or replace into channel(uniqueId, value) values (?, ?)", [this.uniqueId, valueStr]);
        }).then(() => value);
    }
}

class ChannelStateBinder extends RefCounted {
    constructor(platform) {
        super();
        this._platform = platform;
        this._cached = {};
        this.uniqueId = null;
        this._updateTimeout = null;

        this._state = null;
    }

    init(uniqueId) {
        this.uniqueId = uniqueId;
        this._state = new ChannelState(this._platform, uniqueId);
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
            return Promise.resolve();
        this._updateTimeout = null;

        return this._state.write(this._cached);
    }

    _doOpen() {
        return this._state.read().then((value) => {
            this._cached = value || {};
        });
    }

    _doClose() {
        clearTimeout(this._updateTimeout);
        return this.flushToDisk();
    }
}

module.exports = {
    ChannelState,
    ChannelStateBinder
};