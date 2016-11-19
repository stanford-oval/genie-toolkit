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

function connect(filename) {
    return Q.nfcall(acquireConnection, filename).then(function(client) {
        function done(error) {
            if (error)
                console.log('Error in database transaction: ' + error);
            return releaseConnection(filename, client);
        }
        return [client, done];
    });
}

function withClient(filename, callback) {
    return connect(filename).then(function(result) {
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

function withTransaction(filename, transaction) {
    var retryLoop = function() {
        return connect(filename).then(function(connectResult) {
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

module.exports = {
    connect: connect,

    ensureSchema: function(filename) {
        if (!fs.existsSync(filename)) {
            var fullSchemaFile = path.resolve(path.dirname(module.filename), './schema.sql');
            return Q.nfcall(fs.readFile, fullSchemaFile, 'utf8').then((schema) => {
                var db = new sqlite3.Database(filename, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
                var defer = Q.defer();
                db.on('error', function(err) {
                    console.error('Failed to initialize DB schema', err);
                    defer.reject(err);
                });
                db.serialize(function() {
                    db.exec(schema);
                });
                db.close(function(err) {
                    if (!err)
                        defer.resolve();
                });

                return defer.promise;
            });
        } else {
            return Q();
        }
    },

    db: function(filename) {
        return {
            withClient: function(callback) {
                return withClient(filename, callback);
            },
            withTransaction: function(callback) {
                return withTransaction(filename, callback);
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
