// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const db = require('../util/db');
const Q = require('q');

module.exports = {
    get: function(client, id) {
        return db.selectOne(client, "select * from users where id = ?", [id]);
    },

    getByName: function(client, username) {
        return db.selectAll(client, "select * from users where username = ?", [username]);
    },

    create: function(client, username, salt, password, cloudId, authToken) {
        return db.insertOne(client, "insert into users(username, salt, password, cloud_id, auth_token) "
                            + "values (?, ?, ?, ?, ?)",
                            [username, salt, password, cloudId, authToken]);
    },

    getAll: function(client) {
        return db.selectAll(client, "select * from users");
    },
}
