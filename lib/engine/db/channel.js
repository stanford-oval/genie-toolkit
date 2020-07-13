// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
"use strict";

const sql = require('./sqlite');
const Tp = require('thingpedia');

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

class ChannelStateBinder extends Tp.Helpers.RefCounted {
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
