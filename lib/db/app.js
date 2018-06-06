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
