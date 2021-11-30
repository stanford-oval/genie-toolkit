// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2021 The Board of Trustees of the Leland Stanford Junior University
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

import * as sqlite3 from 'sqlite3';
import * as Tp from 'thingpedia';
import * as fs from 'fs';

import type * as DB from '..';

import LocalTable from './local_table';
import SyncTable from './sync_table';
import { initializeDB, migrateDB } from './migration';

export interface SQLitePlatform extends Tp.BasePlatform {
    getSqliteDB() : string;
    getSqliteKey() : string|null;
}

// PRAGMA key = ? does not work, so we have to use string pasting
// this is ok because the key should be trusted
// (and if the key can be manipulated by an attacker, either it will
// be invalid or we have already lost)
export function makeKeyPragma(key : string) {
    return 'PRAGMA key = "x\'' + key.toUpperCase() + '\'"';
}

const connectionPool : Record<string, sqlite3.Database> = {};
function connectNow(filename : string, key : string|null) {
    const db = new sqlite3.Database(filename, sqlite3.OPEN_READWRITE);
    db.serialize(() => {
        db.run('PRAGMA busy_timeout = 1000');
        if (key)
            db.run(makeKeyPragma(key));
    });
    return db;
}
function acquireConnection(filename : string, key : string|null) {
    if (connectionPool[filename])
        return connectionPool[filename];
    return connectionPool[filename] = connectNow(filename, key);
}

export function query(client : sqlite3.Database, string : string, args : unknown[]) {
    return new Promise<void>((resolve, reject) => {
        client.run(string, args, (err) => {
            if (err)
                reject(err);
            else
                resolve();
        });
    });
}

export function selectAll(client : sqlite3.Database, string : string, args : unknown[]) {
    return new Promise<any[]>((resolve, reject) => {
        client.all(string, args, (err, rows) => {
            if (err)
                reject(err);
            else
                resolve(rows);
        });
    });
}

export function selectOne(client : sqlite3.Database, string : string, args : unknown[]) {
    return new Promise<any>((resolve, reject) => {
        client.get(string, args, (err, row) => {
            if (err)
                reject(err);
            else
                resolve(row);
        });
    });
}

export function insertOne(client : sqlite3.Database, string : string, args : unknown[]) {
    return new Promise((callback, errback) => {
        client.run(string, args, function(err) {
            /* eslint-disable no-invalid-this */
            if (err) {
                errback(err);
                return;
            }
            if (this.lastID === undefined)
                errback(new Error("Row does not have ID"));
            else
                callback(this.lastID);
        });
    });
}

const FIELD_NAMES = {
    app: ['code', 'state', 'name', 'description'] as const,
    device: ['state'] as const,
    channel: ['value'] as const,
    conversation: [
        'conversationId',
        'previousId',
        'dialogueId',
        'context',
        'agent',
        'agentTimestamp',
        'agentTarget',
        'intermediateContext',
        'user',
        'userTimestamp',
        'userTarget',
        'vote',
        'comment'
    ] as const,
    conversation_state: [
        'dialogueState',
        'lastMessageId',
        'recording',
    ] as const,
    conversation_history: [
        'conversationId',
        'messageId',
        'message'
    ] as const
};

export class SQLiteDatabase implements DB.AbstractDatabase {
    private _transactionQueue = new WeakMap<sqlite3.Database, Promise<unknown>>();

    constructor(public platform : SQLitePlatform) {}

    withClient<T>(callback : (client : sqlite3.Database) => Promise<T>) : Promise<T> {
        const client = acquireConnection(this.platform.getSqliteDB(), this.platform.getSqliteKey());
        return callback(client);
    }

    withTransaction<T>(transaction : (client : sqlite3.Database) => Promise<T>) : Promise<T> {
        return this.withClient((client) => {
            const queue = this._transactionQueue.get(client) || Promise.resolve();

            return new Promise((callback, errback) => {
                const newqueue = queue.then(async () => {
                    await query(client, 'begin transaction', []);

                    try {
                        const result = await transaction(client);
                        await query(client, 'commit', []);
                        callback(result);
                    } catch(err) {
                        try {
                            await query(client, 'rollback', []);
                            errback(err);
                        } catch(rollerr) {
                            console.error('Ignored error from ROLLBACK', rollerr);
                            errback(err);
                        }
                    }

                    // continue with the queue
                });
                this._transactionQueue.set(client, newqueue);
            });
        });
    }

    ensureSchema() {
        if (!fs.existsSync(this.platform.getSqliteDB()))
            return initializeDB(this.platform);
        else
            return migrateDB(this.platform);
    }

    getLocalTable<T extends keyof DB.LocalTables>(name : T) : LocalTable<DB.LocalTables[T]> {
        return new LocalTable(this, name, FIELD_NAMES[name] as any);
    }
    getSyncTable<T extends keyof DB.SyncTables>(name : T) : SyncTable<DB.SyncTables[T]> {
        return new SyncTable(this, name, FIELD_NAMES[name] as any);
    }
}
