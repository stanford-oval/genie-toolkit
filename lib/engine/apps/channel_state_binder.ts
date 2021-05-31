// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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

import * as Tp from 'thingpedia';

import { AbstractDatabase, LocalTable, ChannelRow } from '../db';

export class ChannelState {
    private _store : LocalTable<ChannelRow>;
    private _uniqueId : string;
    private _cached : Promise<unknown>|null;

    constructor(db : AbstractDatabase, uniqueId : string) {
        this._store = db.getLocalTable('channel');
        this._uniqueId = uniqueId;

        this._cached = null;
    }

    read() {
        if (this._cached !== null)
            return this._cached;

        return this._cached = this._store.getOne(this._uniqueId).then((row) => {
            if (row === undefined)
                return null;
            else
                return JSON.parse(row.value) || null;
        });
    }

    async write(value : unknown) {
        this._cached = Promise.resolve(value);

        const valueStr = JSON.stringify(value);
        if (valueStr === 'null' || valueStr === '{}')
            await this._store.deleteOne(this._uniqueId);
        else
            await this._store.insertOne(this._uniqueId, { value: valueStr });
        return value;
    }
}

export class ChannelStateBinder extends Tp.Helpers.RefCounted {
    readonly uniqueId : string;
    private _state : ChannelState;
    private _cached : Record<string, unknown>;
    private _updateTimeout : NodeJS.Timeout|null;

    constructor(db : AbstractDatabase, uniqueId : string) {
        super();

        this.uniqueId = uniqueId;
        this._state = new ChannelState(db, uniqueId);

        this._cached = {};
        this._updateTimeout = null;
    }

    get(name : string) {
        return this._cached[name];
    }

    set(name : string, value : unknown) {
        this._cached[name] = value;
        this.changed();
    }

    durableSet(name : string, value : unknown) {
        this._cached[name] = value;

        if (this._updateTimeout)
            clearTimeout(this._updateTimeout);
        return this.flushToDisk();
    }

    changed() {
        if (this._updateTimeout)
            clearTimeout(this._updateTimeout);
        this._updateTimeout = setTimeout(this.flushToDisk.bind(this), 500);
    }

    async flushToDisk() {
        if (!this._updateTimeout)
            return;
        this._updateTimeout = null;

        await this._state.write(this._cached);
    }

    protected _doOpen() {
        return this._state.read().then((value) => {
            this._cached = (value || {}) as Record<string, unknown>;
        });
    }

    protected _doClose() {
        if (this._updateTimeout)
            clearTimeout(this._updateTimeout);
        return this.flushToDisk();
    }
}
