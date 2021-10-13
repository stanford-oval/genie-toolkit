// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020-2021 The Board of Trustees of the Leland Stanford Junior University
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
import * as sql from '.';

import type { SyncRecord, SyncAtReply } from '..';

type Field<RowType> = Exclude<keyof RowType & string, "uniqueId">;

export default class SyncTable<RowType extends { uniqueId : string }> {
    name : string;
    fields : ReadonlyArray<Field<RowType>>;
    private _db : sql.SQLiteDatabase;
    private _discriminator : Field<RowType>;

    constructor(db : sql.SQLiteDatabase, name : string, fields : ReadonlyArray<Field<RowType>>) {
        this.name = name;
        this.fields = fields;
        this._db = db;
        this._discriminator = fields[0];
    }

    private _getLastModifiedInternal(client : sqlite3.Database) {
        return sql.selectAll(client, `select max(lastModified) as maxLastModified
                             from ${this.name}_journal`, []).then((rows) : number => {
            if (rows.length === 0 || rows[0].maxLastModified === null)
                return 0;
            else
                return rows[0].maxLastModified;
        });
    }

    getAll() : Promise<RowType[]> {
        return this._db.withClient((client) => {
            return sql.selectAll(client, `select uniqueId, ${this.fields} from ${this.name}`, []);
        });
    }

    getOne(uniqueId : string) : Promise<RowType> {
        return this._db.withClient((client) => {
            return sql.selectOne(client, `select uniqueId,${this.fields.join(',')}
                                 from ${this.name} where uniqueId = ?`, [uniqueId]);
        });
    }

    getRaw() : Promise<Array<SyncRecord<RowType>>> {
        return this._db.withClient((client) => {
            return sql.selectAll(client, `select tj.uniqueId,tj.lastModified,${this.fields.map((f) => 't.' + f)}
                                 from ${this.name}_journal as tj left outer join
                                 ${this.name} as t on tj.uniqueId = t.uniqueId`, []);
        });
    }

    getChangesAfter(lastModified : number) : Promise<Array<SyncRecord<RowType>>> {
        return this._db.withClient((client) => {
            return sql.selectAll(client, `select tj.uniqueId,tj.lastModified,${this.fields.map((f) => 't.' + f).join(',')}
                                 from ${this.name}_journal as tj left outer join
                                 ${this.name} as t on tj.uniqueId = t.uniqueId where
                                 tj.lastModified > ?`, [lastModified]);
        });
    }

    private _handleChangesInternal(client : sqlite3.Database, changes : Array<SyncRecord<RowType>>) : Promise<boolean[]> {
        return Promise.all(changes.map((change) => {
            if (change[this._discriminator] !== null) {
                return this._insertIfRecentInternal(client, change.uniqueId,
                    change.lastModified, change as Omit<RowType, "uniqueId">);
            } else {
                return this._deleteIfRecentInternal(client, change.uniqueId,
                    change.lastModified);
            }
        }));
    }

    handleChanges(changes : Array<SyncRecord<RowType>>) : Promise<boolean[]> {
        return this._db.withTransaction((client) => {
            return this._handleChangesInternal(client, changes);
        });
    }

    syncAt(theirLastModified : number, pushedChanges : Array<SyncRecord<RowType>>) : Promise<SyncAtReply<RowType>> {
        return this._db.withTransaction(async (client) => {
            const ourChanges = await sql.selectAll(client,
                `select tj.uniqueId,tj.lastModified,${this.fields.map((f) => 't.' + f)}
                 from ${this.name}_journal as tj left outer join
                 ${this.name} as t on tj.uniqueId = t.uniqueId where
                 tj.lastModified > ?`, [theirLastModified]);
            const lastModified = await this._getLastModifiedInternal(client);
            const done = await this._handleChangesInternal(client, pushedChanges);
            return { lastModified, ourChanges, done };
        });
    }

    private async _insertInternal(client : sqlite3.Database, uniqueId : string, lastModified : number, row : Omit<RowType, "uniqueId">) {
        const insertSql = `insert or replace into ${this.name} (uniqueId,${this.fields})
            values(?,${this.fields.map(() => '?')})`;
        const param = ([uniqueId] as unknown[]).concat(this.fields.map((f) => row[f]));
        await sql.insertOne(client, insertSql, param);
        await sql.insertOne(client, `insert or replace into ${this.name}_journal
            (uniqueId, lastModified) values(?, ?)`, [uniqueId, lastModified]);
        return lastModified;
    }

    replaceAll(data : Array<SyncRecord<RowType>>) {
        return this._db.withTransaction(async (client) => {
            await sql.query(client, `delete from ${this.name}`, []);
            await sql.query(client, `delete from ${this.name}_journal`, []);
            await Promise.all(data.map(async (row) => {
                const uniqueId = row.uniqueId;
                const lastModified = row.lastModified;
                if (row[this._discriminator] === null)
                    return;
                await this._insertInternal(client, uniqueId, lastModified, row as RowType);
            }));
        });
    }

    private _insertIfRecentInternal(client : sqlite3.Database, uniqueId : string, lastModified : number, row : Omit<RowType, "uniqueId">) {
        return sql.selectAll(client, `select lastModified from ${this.name}_journal where uniqueId = ?`,
            [uniqueId]).then((rows) => {
            if (rows.length > 0 && rows[0].lastModified >= lastModified)
                return false;

            return this._insertInternal(client, uniqueId, lastModified, row).then(() => true);
        });
    }

    insertIfRecent(uniqueId : string, lastModified : number, row : Omit<RowType, "uniqueId">) {
        return this._db.withTransaction((client) => {
            return this._insertIfRecentInternal(client, uniqueId, lastModified, row);
        });
    }

    insertOne(uniqueId : string, row : Omit<RowType, "uniqueId">) {
        return this._db.withTransaction((client) => {
            const now = (new Date).getTime();
            return this._insertInternal(client, uniqueId, now, row);
        });
    }

    private async _deleteInternal(client : sqlite3.Database, uniqueId : string, lastModified : number) {
        await sql.insertOne(client, `delete from ${this.name} where uniqueId = ?`, [uniqueId]);
        await sql.insertOne(client, `insert or replace into ${this.name}_journal
                            (uniqueId, lastModified) values(?, ?)`, [uniqueId, lastModified]);
        return lastModified;
    }

    private _deleteIfRecentInternal(client : sqlite3.Database, uniqueId : string, lastModified : number) {
        return sql.selectAll(client, `select lastModified from ${this.name}_journal where uniqueId = ?`,
            [uniqueId]).then((rows) => {
            if (rows.length > 0 && rows[0].lastModified >= lastModified)
                return false;

            return this._deleteInternal(client, uniqueId, lastModified).then(() => true);
        });
    }

    deleteIfRecent(uniqueId : string, lastModified : number) {
        return this._db.withTransaction((client) => {
            return this._deleteIfRecentInternal(client, uniqueId, lastModified);
        });
    }

    deleteOne(uniqueId : string) {
        return this._db.withTransaction((client) => {
            return this._deleteInternal(client, uniqueId, Date.now());
        });
    }
}
