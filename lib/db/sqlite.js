// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const sqlite3 = require('sqlite3');
const fs = require('fs');
const Q = require('q');

var connectionPool = {};
function connectNow(filename, key) {
    let db = new sqlite3.Database(filename, sqlite3.OPEN_READWRITE);
    db.serialize(() => {
        db.run('PRAGMA busy_timeout = 1000');
        if (key)
            db.run(makeKeyPragma(key));
    });
    return db;
}
function acquireConnection(filename, key) {
    if (connectionPool[filename])
        return connectionPool[filename];
    return connectionPool[filename] = connectNow(filename, key);
}

function query(client, string, args) {
    return Q.ninvoke(client, 'run', string, args);
}

function selectAll(client, string, args) {
    return Q.ninvoke(client, 'all', string, args);
}

function selectOne(client, string, args) {
    return Q.ninvoke(client, 'get', string, args);
}

// PRAGMA key = ? does not work, so we have to use string pasting
// this is ok because the key should be trusted
// (and if the key can be manipulated by an attacker, either it will
// be invalid or we have already lost)
function makeKeyPragma(key) {
    return 'PRAGMA key = "x\'' + key.toUpperCase() + '\'"';
}

function withClient(filename, key, callback) {
    let client = acquireConnection(filename, key);
    return callback(client);
}

const _transactionQueue = new WeakMap;
function withTransaction(filename, key, transaction) {
    return withClient(filename, key, (client) => {
        let queue = _transactionQueue.get(client);
        if (!queue)
            queue = Promise.resolve();

        return new new Promise((callback, errback) => {
            queue = queue.then(() => query(client, 'begin transaction', [])).then(() => {
                return transaction(client);
            }).then((result) => {
                return Q.ninvoke(client, 'run', 'commit', []).then(() => {
                    callback(result);
                });
            }).catch((err) => {
                return Q.ninvoke(client, 'run', 'rollback', []).then(() => {
                    errback(err);
                    // continue with the queue
                }, (rollerr) => {
                    console.error('Ignored error from ROLLBACK', rollerr);
                    errback(err);
                    // continue with the queue
                });
            });
            _transactionQueue.set(client, queue);
        });
    });
}

function initializeDB(platform) {
    var filename = platform.getSqliteDB();
    var key = platform.getSqliteKey();
    var prefs = platform.getSharedPreferences();
    prefs.set('sqlite-schema-version', currentVersion);

    var schema = require('./schema.json');
    var db = new sqlite3.Database(filename, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
    var defer = Q.defer();
    db.on('error', (err) => {
        console.error('Failed to initialize DB schema', err);
        defer.reject(err);
    });
    db.serialize(() => {
        if (key) {
            console.log('Initializing key in Sqlite DB');
            db.run(makeKeyPragma(key));
        }
        db.run('PRAGMA journal_mode=WAL');
        db.exec(schema);
    });
    db.close((err) => {
        if (!err)
            defer.resolve();
    });

    return defer.promise;
}

const MIGRATIONS = [
function migrateTo1(db) {
    db.serialize(() => {
        db.run('drop table if exists keyword');
        db.run('create table keyword (uniqueId varchar(255) primary key, value text default null)');
        db.run('drop table if exists channel');
        db.run('create table channel (uniqueId varchar(255) primary key, value text default null)');
    });
},
function migrateTo2(db) {
    db.serialize(() => {
        db.run('drop table if exists permissions');
        db.run('create table permissions (uniqueId varchar(255) primary key, compat_key text, code text, extra text)');
        db.run('create index permissions_compat_key on permissions(compat_key)');
    });
},
function migrateTo3(db) {
    db.serialize(() => {
        db.run('create table if not exists permissions (uniqueId varchar(255) primary key, compat_key text, code text, extra text)');
        db.run('create index if not exists permissions_compat_key on permissions(compat_key)');
    });
},
function migrateTo4(db) {
    db.serialize(() => {
        db.run('alter table permissions add extra text default null');
    });
},
function migrateTo5(db) {
    db.serialize(() => {
        db.run(`create table matrix_sync (
            owner_id text,
            object_key text,
            object_value text,
            primary key(owner_id, object_key)
        )`);
        db.run(`create table matrix_accountData (
            owner_id text,
            object_key text,
            object_value text,
            primary key(owner_id, object_key)
        )`);
        db.run(`create table matrix_users (
            owner_id text,
            object_key text,
            object_value text,
            primary key(owner_id, object_key)
        )`);
    });
},
function migrateTo6(db) {
    db.serialize(() => {
        db.run(`create table matrix_outgoingRoomKeyRequests (
            owner_id text,
            request_id text,
            room_id text,
            session_id text,
            state int,
            object text,
            primary key(owner_id, request_id)
        )`);
        db.run(`create index matrix_outgoingRoomKeyRequests_session on matrix_outgoingRoomKeyRequests(owner_id, room_id, session_id)`);
        db.run(`create index matrix_outgoingRoomKeyRequests_state on matrix_outgoingRoomKeyRequests(owner_id, state)`);
    });
},
function migrateTo7(db) {
    // nothing to do, just bump the version number...
},
function migrateTo8(db) {
    db.serialize(() => {
        db.run(`create table if not exists memory_table_meta (
    name text primary key,
    args text,
    types text
)`);
    });
}];
var currentVersion = MIGRATIONS.length;

function migrateDB(platform) {
    // cloud migrations are handled out of band
    var filename = platform.getSqliteDB();
    var key = platform.getSqliteKey();
    var prefs = platform.getSharedPreferences();
    var version = prefs.get('sqlite-schema-version');
    if (version === undefined)
        version = 1;
    if (version === currentVersion)
        return Q();
    prefs.set('sqlite-schema-version', currentVersion);

    console.log('Database needs migration...');
    var db = new sqlite3.Database(filename, sqlite3.OPEN_READWRITE);
    return new Promise((callback, errback) => {
        db.on('error', errback);
        if (key)
            db.run(makeKeyPragma(key));
        MIGRATIONS.forEach((migration, migrateTo) => {
            // migrations start at 1 (see above)
            migrateTo = migrateTo+1;
            if (version < migrateTo)
                migration(db);
        });

        db.close((err) => {
            if (!err)
                console.log('Successfully migrated database to version ' + currentVersion);
            if (err)
                errback(err);
            else
                callback();
        });
    });
}

module.exports = {
    ensureSchema(platform) {
        if (!fs.existsSync(platform.getSqliteDB()))
            return initializeDB(platform);
        else
            return migrateDB(platform);
    },

    db(filename, key) {
        return {
            connect: function() {
                return acquireConnection(filename, key);
            },

            withClient: function(callback) {
                return withClient(filename, key, callback);
            },
            withTransaction: function(callback) {
                return withTransaction(filename, key, callback);
            }
        };
    },

    withClient,
    withTransaction,

    selectOne,
    selectAll,

    insertOne(client, string, args) {
        return new Promise((callback, errback) => {
            client.run(string, args, (err) => {
                if (err) {
                    errback(err);
                    return;
                }
                if (this.lastID === undefined)
                    errback(new Error("Row does not have ID"));
                else
                    callback(this.lastID);
            });
        });
    },

    query: query,
    create: query,
    drop: query
};
