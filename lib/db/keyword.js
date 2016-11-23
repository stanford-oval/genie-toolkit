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

module.exports = class KeywordDatabase {
    constructor(platform) {
        this._db = sql.db(platform.getSqliteDB(), platform.getSqliteKey());
    }

    getOne(uniqueId) {
        return this._db.withClient((dbClient) => {
            return sql.selectOne("select value from keyword where uniqueId = ?", [uniqueId]).then((row) => {
                return row === undefined ? null : JSON.parse(row.value);
            });
        });
    }

    insertOne(uniqueId, value) {
        return this._db.withTransaction((dbClient) => {
            return sql.insertOne("insert or replace into keyword(uniqueId, value) values (?, ?)", [uniqueId, JSON.stringify(value)]);
        });
    }

    deleteOne(uniqueId) {
        return this._db.withTransaction((dbClient) => {
            return sql.query("delete from keyword where uniqueId = ?", [uniqueId]);
        });
    }
};
