// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const sql = require('./sql');

module.exports = new lang.Class({
    Name: 'SQLDatabase',

    _init: function(filename, tablename, fields) {
        this.tablename = tablename;
        this.fields = fields;
        this._discriminator = fields[0];
        this._db = sql.db(filename);
    },

    _getLastModifiedInternal: function(client) {
        return sql.selectAll(client, 'select max(lastModified) as maxLastModified'
                             + ' from ' + this.tablename + '_journal')
            .then(function(rows) {
                if (rows.length == 0 || rows[0].maxLastModified == null) {
                    return 0;
                } else {
                    return rows[0].maxLastModified;
                }
            });
    },

    getAll: function() {
        return this._db.withClient(function(client) {
            return sql.selectAll(client, 'select uniqueId,' + this.fields.join(',')
                                 + ' from ' + this.tablename, []);
        }.bind(this));
    },

    getOne: function(uniqueId) {
        return this._db.withClient(function(client) {
            return sql.selectOne(client, 'select uniqueId,' + this.fields.join(',')
                                 + ' from ' + this.tablename
                                 + ' where uniqueId = ?', [uniqueId]);
        }.bind(this));
    },

    getRaw: function() {
        return this._db.withClient(function(client) {
            return sql.selectAll(client, 'select tj.uniqueId,tj.lastModified,' + ((this.fields.map(function(f) { return 't.' + f; })).join(','))
                                 + ' from ' + this.tablename + '_journal as tj left outer join '
                                 + this.tablename + ' as t on tj.uniqueId = t.uniqueId');
        }.bind(this));
    },

    getChangesAfter: function(lastModified) {
        return this._db.withClient(function(client) {
            return sql.selectAll(client, 'select tj.uniqueId,tj.lastModified,' + ((this.fields.map(function(f) { return 't.' + f; })).join(','))
                                 + ' from ' + this.tablename + '_journal as tj left outer join '
                                 + this.tablename + ' as t on tj.uniqueId = t.uniqueId where '
                                 + 'tj.lastModified > ?', [lastModified]);
        }.bind(this));
    },

    _handleChangesInternal: function(client, changes) {
        return Q.all(changes.map(function(change) {
            if (change[this._discriminator] !== null)
                return this._insertIfRecentInternal(client, change.uniqueId,
                                                    change.lastModified, change);
            else
                return this._deleteIfRecentInternal(client, change.uniqueId,
                                                    change.lastModified);
        }.bind(this)));
    },

    handleChanges: function(changes) {
        return this._db.withTransaction(function(client) {
            // insertIfRecentInternal
            return this._handleChangesInternal(client, changes);
        }.bind(this));
    },

    syncAt: function(lastModified, pushedChanges) {
        return this._db.withTransaction(function(client) {
            return sql.selectAll(client, 'select tj.uniqueId,tj.lastModified,' + ((this.fields.map(function(f) { return 't.' + f; })).join(','))
                                 + ' from ' + this.tablename + '_journal as tj left outer join '
                                 + this.tablename + ' as t on tj.uniqueId = t.uniqueId where '
                                 + 'tj.lastModified > ?', [lastModified])
                .then(function(ourChanges) {
                    return this._getLastModifiedInternal(client)
                        .then(function(lastModified) {
                            return this._handleChangesInternal(client, pushedChanges)
                                .then(function(done) {
                                    return [lastModified, ourChanges, done];
                                });
                        }.bind(this));
                }.bind(this));
        }.bind(this));
    },

    _insertInternal: function(client, uniqueId, lastModified, row) {
        var insertSql = 'insert or replace into ' + this.tablename +
            ' (uniqueId,' + (this.fields.join(',')) + ') ' +
            ' values(?,' + ((this.fields.map(function(f) { return '?' })).join(',')) + ')';
        var param = [uniqueId].concat(this.fields.map(function(f) { return row[f]; }));
        return sql.insertOne(client, insertSql, param)
            .then(function() {
                return sql.insertOne(client, 'insert or replace into ' + this.tablename + '_journal'
                                     + ' (uniqueId, lastModified) ' +
                                     'values(?, ?)', [uniqueId, lastModified]);
            }.bind(this))
            .then(function() {
                if (typeof lastModified == 'object')
                    return lastModified.getTime();
                else
                    return lastModified;
            });
    },

    replaceAll: function(data) {
        var self = this;
        return this._db.withTransaction(function(client) {
            return sql.query(client, 'delete from ' + self.tablename)
                .then(function() {
                    return sql.query(client, 'delete from ' + self.tablename + '_journal');
                })
                .then(function() {
                    return Q.all(data.map(function(row) {
                        var uniqueId = row.uniqueId;
                        var lastModified = row.lastModified;

                        return self._insertInternal(client, uniqueId, lastModified, row);
                    }));
                });
        });
    },

    _insertIfRecentInternal: function(client, uniqueId, lastModified, row) {
        return sql.selectAll(client, 'select lastModified from '
                             + this.tablename + '_journal where uniqueId = ?',
                             [uniqueId])
            .then(function(rows) {
                if (rows.length > 0 && rows[0].lastModified >= lastModified)
                    return false;

                return this._insertInternal(client, uniqueId, lastModified, row).then(function() {
                    return true;
                });
            }.bind(this));
    },

    insertIfRecent: function(uniqueId, lastModified, row) {
        var self = this;
        return this._db.withTransaction(function(client) {
            return this._insertIfRecentInternal(client, uniqueId, lastModified, row);
        }.bind(this));
    },

    insertOne: function(uniqueId, row) {
        var self = this;

        return this._db.withTransaction(function(client) {
            var now = new Date;
            return self._insertInternal(client, uniqueId, now, row);
        });
    },

    _deleteInternal: function(client, uniqueId, lastModified) {
        return sql.insertOne(client, 'delete from ' + this.tablename +
                             ' where uniqueId = ? ', [uniqueId])
            .then(function() {
                return sql.insertOne(client, 'insert or replace into ' + this.tablename + '_journal'
                                     + ' (uniqueId, lastModified) ' +
                                     'values(?, ?)', [uniqueId, lastModified]);
            }.bind(this))
            .then(function() {
                if (typeof lastModified == 'object')
                    return lastModified.getTime();
                else
                    return lastModified;
            });
    },

    _deleteIfRecentInternal: function(client, uniqueId, lastModified) {
        return sql.selectAll(client, 'select lastModified from '
                             + this.tablename + '_journal where uniqueId = ?',
                             [uniqueId])
            .then(function(rows) {
                if (rows.length > 0 && rows[0].lastModified >= lastModified)
                    return false;

                return this._deleteInternal(client, uniqueId, lastModified)
                    .then(function() {
                        return true;
                    });
            }.bind(this));
    },

    deleteIfRecent: function(uniqueId, lastModified) {
        return this._db.withTransaction(function(client) {
            return this._deleteIfRecentInternal(client, uniqueId, lastModified);
        }.bind(this));
    },

    deleteOne: function(uniqueId) {
        var self = this;

        return this._db.withTransaction(function(client) {
            var now = new Date;
            return self._deleteInternal(client, uniqueId, now);
        });
    }
});
