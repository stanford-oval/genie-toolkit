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

import * as sql from '.';
import type { SearchParams } from '..';

type Fields<RowType> = ReadonlyArray<Exclude<keyof RowType & string, "uniqueId">>;

export default class LocalTable<RowType> {
    name : string;
    private _db : sql.SQLiteDatabase;
    private _fields : Fields<RowType>;

    constructor(db : sql.SQLiteDatabase, name : string, fields : Fields<RowType>) {
        this.name = name;
        this._db = db;
        this._fields = fields;
    }

    getAll() : Promise<RowType[]> {
        return this._db.withClient((client) => {
            return sql.selectAll(client, `select * from ${this.name}`, []);
        });
    }

    getOne(uniqueId : string) : Promise<RowType> {
        return this._db.withClient((client) => {
            return sql.selectOne(client, `select * from ${this.name} where uniqueId = ?`, [uniqueId]);
        });
    }

    getBy(field : keyof RowType, value : string) : Promise<RowType[]> {
        return this._db.withClient((client) => {
            return sql.selectAll(client, `select * from ${this.name} where ${field} = ?`, [value]);
        });
    }

    search(search : SearchParams<RowType>) {
        return this._db.withClient((client) => {
            const values = search.filter.map((f) => f.v);
            const filter = search.filter.map((f) => `${f.k} ${f.o} ?`).join(' and ');
            return sql.selectAll(client, `select * from ${this.name} where ${filter || 'true'} order by ${search.sort[0]} ${search.sort[1]} limit ${search.limit}`, values);
        });
    }

    insertOne(uniqueId : string, row : Omit<RowType, "uniqueId">) : Promise<void> {
        return this._db.withTransaction(async (client) => {
            const insertSql = `insert or replace into ${this.name}(uniqueId, ${this._fields}) values(?,${this._fields.map(() => '?')})`;
            const param = ([uniqueId] as unknown[]).concat(this._fields.map((f) => row[f]));
            await sql.insertOne(client, insertSql, param);
        });
    }

    deleteOne(uniqueId : string) : Promise<void> {
        return this._db.withTransaction(async (client) => {
            await sql.query(client, `delete from ${this.name} where uniqueId = ?`, [uniqueId]);
        });
    }
}
