// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const Q = require('q');

var connectionPool = {};
function acquireConnection(filename, callback) {
    if (filename in connectionPool) {
        var pooled = connectionPool[filename];
        if (pooled.length > 0)
            callback(null, pooled.pop());
    }

    connectionPool[filename] = [];
    var db = new sqlite3.Database(filename, sqlite3.OPEN_READWRITE, function(err) {
        if (err) {
            callback(err);
        } else {
            callback(null, db);
        }
    });
}

function releaseConnection(filename, db, callback) {
    if (!(filename in connectionPool)) {
        callback(new Error('Connection to ' + filename + ' is not open'));
        return;
    }

    var pooled = connectionPool[filename];
    pooled.push(db);
    if (pooled.length > 3) {
        pooled.shift().close(callback);
    } else {
        callback(null);
    }
}

function rollback(client, err, done) {
    return Q.ninvoke(client, 'run', 'rollback', []).then(function() {
        done();
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
    return Q.ninvoke(client, 'get', string, args).then(function(row) {
        if (row === undefined)
            throw new Error("Did not find a row matching this query");

        return row;
    });
}

function connect(filename) {
    return Q.nfcall(acquireConnection, filename).then(function(client) {
        function done(error) {
            if (error)
                console.log('Error in database transaction: ' + error);
            return Q.nfcall(releaseConnection, filename, client).done();
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
    });
}

module.exports = {
    connect: connect,

    ensureSchema: function(filename, schemaFile) {
        if (!fs.existsSync(filename)) {
            var fullSchemaFile = path.join(path.dirname(module.filename),
                                           schemaFile);
            var schema = fs.readFileSync(fullSchemaFile, 'utf8');
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
            client.run(string, args, function() {
                if (this.lastID === undefined)
                    errback(new Error("Row does not have ID"));
                else
                    callback(this.lastID);
            });
        });
    },

    query: query
};
