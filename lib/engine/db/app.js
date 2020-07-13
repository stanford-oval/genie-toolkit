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

module.exports = class AppDatabase {
    constructor(platform) {
        this._db = sql.db(platform.getSqliteDB(), platform.getSqliteKey());
    }

    getAll() {
        return this._db.withClient((client) => {
            return sql.selectAll(client, 'select * from app', []);
        });
    }

    getOne(uniqueId) {
        return this._db.withClient((client) => {
            return sql.selectOne(client, 'select * from app where uniqueId = ?', [uniqueId]);
        });
    }

    insertOne(uniqueId, row) {
        return this._db.withTransaction((client) => {
            const insertSql = 'insert or replace into app(uniqueId, code, state, name, description)' +
                ' values(?,?,?,?,?)';
            const param = [uniqueId, row.code, row.state, row.name, row.description];
            return sql.insertOne(client, insertSql, param);
        });
    }

    deleteOne(uniqueId) {
        return this._db.withTransaction((client) => {
            return sql.query(client, 'delete from app where uniqueId = ? ', [uniqueId]);
        });
    }
};
