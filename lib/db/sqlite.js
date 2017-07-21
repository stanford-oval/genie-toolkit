// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const Q = require('q');

const CONNECTION_LIMIT = 1;
var connectionPool = {};
function connectNow(filename, callback) {
    var db = new sqlite3.Database(filename, sqlite3.OPEN_READWRITE, function(err) {
        if (err) {
            callback(err);
        } else {
            db.run('PRAGMA busy_timeout = 1000');
            callback(null, db);
        }
    });
}
function acquireConnection(filename, callback) {
    if (filename in connectionPool) {
        var pooled = connectionPool[filename];
        if (pooled.connections.length > 0) {
            callback(null, pooled.connections.pop());
            return;
        }
        if (pooled.active >= CONNECTION_LIMIT) {
            pooled.queue.push(callback);
            return;
        }

        pooled.active++;
    } else {
        connectionPool[filename] = {
            connections: [],
            active: 1,
            queue: []
        };
    }

    connectNow(filename, callback);
}

function releaseConnection(filename, db) {
    if (!(filename in connectionPool))
        throw new Error('Connection to ' + filename + ' is not open');

    var pooled = connectionPool[filename];
    if (pooled.queue.length > 0) {
        var next = pooled.queue.shift();
        next(null, db);
        return;
    }

    pooled.active --;
    if (pooled.connections.length > 3)
        db.close();
    else
        pooled.connections.push(db);
}

function rollback(client, err, done) {
    return Q.ninvoke(client, 'run', 'rollback', []).then(function() {
        done();
        console.log('Error in db transaction, rollbacking: ' + err);
        throw err;
    }, function(rollerr) {
        done(rollerr);
        throw err;
    });
}

function commit(client, result, done) {
    return Q.ninvoke(client, 'run', 'commit', []).then(function() {
        done();
        return result;
    });
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

function connect(filename, key) {
    return Q.nfcall(acquireConnection, filename).then(function(client) {
        if (key)
            return Q.ninvoke(client, 'run', makeKeyPragma(key)).then(() => client);
        else
            return client;
    }).then(function(client) {
        function done(error) {
            if (error)
                console.log('Error in database transaction: ' + error);
            return releaseConnection(filename, client);
        }
        return [client, done];
    });
}

function withClient(filename, key, callback) {
    return connect(filename, key).then(function(result) {
        var client = result[0];
        var done = result[1];

        return callback(client).then(function(result) {
            done();
            return result;
        }, function(err) {
            done();
            throw err;
        });
    });
}

function withTransaction(filename, key, transaction) {
    var retryLoop = function() {
        return connect(filename, key).then(function(connectResult) {
            var client = connectResult[0];
            var done = connectResult[1];

            // SQL standard is 'start transaction', but meh... sqlite!
            return query(client, 'begin transaction').then(function() {
                return transaction(client).then(function(result) {
                    return commit(client, result, done);
                }).catch(function(err) {
                    return rollback(client, err, done);
                });
            }, function(error) {
                done(error);
                throw error;
            });
        }).catch(function(e) {
            if (e.message.startsWith('SQLITE_BUSY')) {
                // sqlite locking model is awful, it fails and expects you to retry the transaction
                // at a later time
                return Q.delay(1000).then(retryLoop);
            } else {
                throw e;
            }
        });
    };

    return retryLoop();
}

function initializeDB(platform) {
    var filename = platform.getSqliteDB();
    var key = platform.getSqliteKey();
    var prefs = platform.getSharedPreferences();
    prefs.set('sqlite-schema-version', currentVersion);

    var schema = require('./schema.json');
    var db = new sqlite3.Database(filename, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
    var defer = Q.defer();
    db.on('error', function(err) {
        console.error('Failed to initialize DB schema', err);
        defer.reject(err);
    });
    db.serialize(function() {
        if (key) {
            console.log('Initializing key in Sqlite DB');
            db.run(makeKeyPragma(key));
        }
        db.exec(schema);
    });
    db.close(function(err) {
        if (!err)
            defer.resolve();
    });

    return defer.promise;
}

var currentVersion = 2;

function migrateTo1(db) {
    db.serialize(function() {
        db.run('drop table if exists keyword');
        db.run('create table keyword (uniqueId varchar(255) primary key, value text default null)');
        db.run('drop table if exists channel');
        db.run('create table channel (uniqueId varchar(255) primary key, value text default null)');
    });
}

function migrateTo2(db) {
    db.serialize(function() {
        db.run('drop table if exists permissions');
        db.run('create table permissions (uniqueId varchar(255) primary key, compat_key text, code text)');
        db.run('create index permissions_compat_key on permissions(compat_key)');
    });
}

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
    return Q.Promise(function(callback, errback) {
        db.on('error', errback);
        if (key) {
            db.run(makeKeyPragma(key));
        }
        if (version < 1)
            migrateTo1(db);
        if (version < 2)
            migrateTo2(db);

        db.close(function(err) {
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
    connect: connect,

    ensureSchema: function(platform) {
        if (!fs.existsSync(platform.getSqliteDB())) {
            return initializeDB(platform);
        } else {
            return migrateDB(platform);
        }
    },

    db: function(filename, key) {
        return {
            withClient: function(callback) {
                return withClient(filename, key, callback);
            },
            withTransaction: function(callback) {
                return withTransaction(filename, key, callback);
            }
        };
    },

    withClient: withClient,
    withTransaction: withTransaction,

    selectOne: selectOne,
    selectAll: selectAll,

    insertOne: function(client, string, args) {
        return Q.Promise(function(callback, errback) {
            client.run(string, args, function(err) {
                if (err)
                    return errback(err);
                if (this.lastID === undefined)
                    errback(new Error("Row does not have ID"));
                else
                    callback(this.lastID);
            });
        });
    },

    query: query
};
