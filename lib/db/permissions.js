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

const Q = require('q');

const sql = require('./sqlite');

module.exports = class PermissionDatabase {
    constructor(platform) {
        this._db = sql.db(platform.getSqliteDB(), platform.getSqliteKey());
    }

    getCompatible(compat_key) {
        return this._db.withClient(function(client) {
            return sql.selectAll(client, 'select * from permissions where compat_key like ?', [compat_key]);
        });
    }

    getAll() {
        return this._db.withClient(function(client) {
            return sql.selectAll(client, 'select * from permissions', []);
        });
    }

    insertOne(uniqueId, row) {
        return this._db.withTransaction(function(client) {
            var insertSql = 'insert or replace into permissions(uniqueId, compat_key, code, extra) values(?,?,?, ?)';
            var param = [uniqueId, row.compat_key, row.code, row.extra];
            return sql.insertOne(client, insertSql, param);
        });
    }

    deleteOne(uniqueId) {
        return this._db.withTransaction(function(client) {
            return sql.query(client, 'delete from permissions where uniqueId = ? ', [uniqueId]);
        });
    }
};
