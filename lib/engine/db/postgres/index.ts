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

import * as Tp from 'thingpedia';

import type * as DB from '..';

import { Pool, PoolClient, } from 'pg';

import LocalTable from './local_table';
import SyncTable from './sync_table';


export interface PostgresPlatform extends Tp.BasePlatform {
    getPostgresConfig() : any;
}

export function query(client : PoolClient, string : string, args : unknown[]) {
    return new Promise<void>((resolve, reject) => {
        client.query(string, args, (err) => {
            if (err)
                reject(err);
            else
                resolve();
        });
    });
}

export function selectAll(client : PoolClient, string : string, args : unknown[]) {
    return new Promise<any[]>((resolve, reject) => {
        client.query(string, args, (err, res) => {
            if (err)
                reject(err);
            else
                resolve(res.rows);
        });
    });
}

export function selectOne(client : PoolClient, string : string, args : unknown[]) {
    return new Promise<any>((resolve, reject) => {
        client.query(string, args, (err, result) => {
            if (err)
                reject(err);
            else
                resolve(result.rows[0]);
        });
    });
}

export function insertOne(client : PoolClient, string : string, args : unknown[]) {
    return new Promise((callback, errback) => {
        const stringReturingId  = string + ' RETURNING uniqueid';
        client.query(stringReturingId, args, (err, result) => {
            if (err) {
                errback(err);
                return;
            }
            if (result === undefined) {
                errback(new Error('Row does not have uniqueId'));
                return;
            }
            callback(result.rows);
        });
    });
}

const FIELD_NAMES = {
    app: ['code', 'state', 'name', 'description'] as const,
    device: ['state'] as const,
    channel: ['value'] as const
};

export class PostgresDatabase implements DB.AbstractDatabase {
    private _pool : Pool;
    private _transactionQueue = new WeakMap<PoolClient, Promise<unknown>>();

    constructor(public platform : PostgresPlatform) {
        this._pool = new Pool(platform.getPostgresConfig());
    }

    withClient<T>(callback : (client : PoolClient) => Promise<T>) : Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this._pool.connect((err, c, release) => {
                if (err) {
                    console.error('Error in acquiring client', err.stack);
                    reject(err);
                    return;
                }
                resolve(callback(c));
                release();
            });
        });
    }

    withTransaction<T>(transaction : (client : PoolClient) => Promise<T>) : Promise<T> {
        return this.withClient((client) => {
            const queue = this._transactionQueue.get(client) || Promise.resolve();
            return new Promise((callback, errback) => {
                const newqueue = queue.then(async () => {
                    await client.query('BEGIN;');
                    try {
                        const result = await transaction(client);
                        await client.query('COMMIT;');
                        callback(result);
                    } catch(err) {
                        console.log(`COMMIT ERROR:${JSON.stringify(err)}`);
                        client.query('ROLLBACK;', () => {
                            console.log('Rolling back transaction.');
                        });
                        errback(err);
                    }
                    // continue with the queue
                });
                this._transactionQueue.set(client, newqueue);
            });
        });
    }

    ensureSchema() {
        // Database is initialized out of band
        // eslint-disable-next-line no-promise-executor-return
        return new Promise<void>((resolve, reject) => resolve());
    }

    getLocalTable<T extends keyof DB.LocalTables>(name : T) : LocalTable<DB.LocalTables[T]> {
        return new LocalTable(this, name, FIELD_NAMES[name] as any);
    }

    getSyncTable<T extends keyof DB.SyncTables>(name : T) : SyncTable<DB.SyncTables[T]> {
        return new SyncTable(this, name, FIELD_NAMES[name] as any);
    }
}
