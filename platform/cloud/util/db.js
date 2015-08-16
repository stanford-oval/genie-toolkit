// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const pg = require('pg');
const Q = require('q');

function getDBUrl() {
    var url = process.env.DATABASE_URL;
    if (url === undefined)
        return "postgres://thingengine:thingengine@localhost/thingengine";
    else
        return url;
}

function query(client, string, args) {
    return Q.ninvoke(client, 'query', string, args);
}

function rollback(client, err, done) {
    return query(client, 'rollback').then(function() {
        done();
        throw err;
    }, function(rollerr) {
        done(rollerr);
        throw err;
    });
}

function commit(client, result, done) {
    return query(client, 'commit').then(function() {
        done();
        return result;
    });
}

function selectOne(client, string, args) {
    return query(client, string, args).then(function(result) {
        if (result.rows.length != 1)
            throw new Error("Wrong number of rows returned, expected 1, got " + result.rows.length);

        return result.rows[0];
    });
}

function selectAll(client, string, args) {
    return query(client, string, args).then(function(result) {
        return result.rows;
    });
}

function connect() {
    return Q.ninvoke(pg, 'connect', getDBUrl());
}

module.exports = {
    connect: connect,

    withClient: function(callback) {
        return connect().then(function(result) {
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
    },

    withTransaction: function(transaction) {
        return connect().then(function(connectResult) {
            var client = connectResult[0];
            var done = connectResult[1];

            return query(client, 'start transaction').then(function() {
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
    },

    insertOne: function(client, query, args) {
        return selectOne(client, query, args).then(function(row) {
            if (!row.id)
                throw new Error("Row does not have ID");

            return row.id;
        });
    },

    selectOne: selectOne,
    selectAll: selectAll,

    query: query
};
