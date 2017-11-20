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

module.exports = class ChannelStateDatabase {
    constructor(platform) {
        this._db = sql.db(platform.getSqliteDB(), platform.getSqliteKey());
    }

    getOne(uniqueId) {
        return this._db.withClient((dbClient) => {
            return sql.selectOne(dbClient, "select value from channel where uniqueId = ?", [uniqueId]).then((row) => {
                return row === undefined ? {} : JSON.parse(row.value);
            });
        });
    }

    insertOne(uniqueId, value) {
        return this._db.withTransaction((dbClient) => {
            let valueStr = JSON.stringify(value);
            if (valueStr === '{}')
                return sql.drop(dbClient, "delete from channel where uniqueId = ?", [uniqueId]);
            else
                return sql.insertOne(dbClient, "insert or replace into channel(uniqueId, value) values (?, ?)", [uniqueId, ]);
        });
    }
};
