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

module.exports = class AppDatabase {
    constructor(platform) {
        this._db = sql.db(platform.getSqliteDB(), platform.getSqliteKey());
    }

    getAll() {
        return this._db.withClient(function(client) {
            return sql.selectAll(client, 'select * from app', []);
        });
    }

    getOne(uniqueId) {
        return this._db.withClient(function(client) {
            return sql.selectOne(client, 'select * from app where uniqueId = ?', [uniqueId]);
        });
    }

    insertOne(uniqueId, row) {
        return this._db.withTransaction(function(client) {
            var insertSql = 'insert or replace into app(uniqueId, code, state, name, description)' +
                ' values(?,?,?,?,?)';
            var param = [uniqueId, row.code, row.state, row.name, row.description];
            return sql.insertOne(client, insertSql, param);
        });
    }

    deleteOne(uniqueId) {
        return this._db.withTransaction(function(client) {
            return sql.query(client, 'delete from app where uniqueId = ? ', [uniqueId]);
        });
    }
}
