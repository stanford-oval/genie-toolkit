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

    _init: function(filename, tablename) {
        this.tablename = tablename;
        this._journalCleanupTimeout = null;

        this._db = sql.db(filename);
    },

    _scheduleJournalCleanup: function() {
        if (this._journalCleanupTimeout)
            return;

        // in 5 minutes, cleanup the journal after some modifications
        this._journalCleanupTimeout = setTimeout(function() {
            this._journalCleanupTimeout = null;
            this._cleanupJournal();
        }.bind(this), 300000);
    },

    _cleanupJournal: function() {
        this._db.withTransaction(function(client) {
            var now = new Date();
            var oneWeekAgo = (new Date()).setTime(now.getTime() - 7 * 24 * 3600 * 1000);
            return sql.query(client, 'delete from ' + this.tablename + '_journal' +
                             ' where lastModified < ?', [oneWeekAgo]);
        }.bind(this)).done();
    },

    _getLastModifiedInternal: function(client) {
        return sql.selectAll(client, 'select max(lastModified) as maxLastModified'
                             + ' from ' + this.tablename + '_journal')
            .then(function(rows) {
                if (rows.length == 0 || rows[0].maxLastModified == null) {
                    return (new Date).getTime();
                } else {
                    return rows.maxLastModified;
                }
            });
    },

    getAll: function() {
        return this._db.withClient(function(client) {
return sql.selectAll(client, 'select uniqueId,state from ' + this.tablename, [])
                .then(function(rows) {
                    return rows.map(function(row) {
                        var state = JSON.parse(row.state);
                        state.uniqueId = row.uniqueId;
                        return state;
                    });
                });
        }.bind(this));
    },

    getOne: function(uniqueId) {
        return this._db.withClient(function(client) {
            return sql.selectOne(client, 'select state from ' + this.tablename
                                 + ' where uniqueId = ?', [uniqueId])
                .then(function(row) {
                    var state = JSON.parse(row.state);
                    state.uniqueId = row.uniqueId;
                    return state;
                });
        }.bind(this));
    },

    getRaw: function() {
        return this._db.withClient(function(client) {
            return sql.selectAll(client, 'select uniqueId,lastModified,state from ' + this.tablename, [])
                .then(function(values) {
                    return this._getLastModifiedInternal(client)
                        .then(function(lastModified) {
                            return [lastModified, values];
                        });
                }.bind(this));
        }.bind(this));
    },

    getChangesAfter: function(lastModified) {
        return this._db.withClient(function(client) {
            return sql.selectAll(client, 'select uniqueId,lastModified,state '
                                 + 'from ' + this.tablename + '_journal where '
                                 + 'lastModified >= ?', [lastModified]);
        }.bind(this));
    },

    _handleChangesInternal: function(client, changes) {
        return Q.all(changes.map(function(change) {
            if (change.state !== undefined)
                return this._insertIfRecentInternal(client, change.uniqueId,
                                                    change.lastModified, change.state);
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
            return sql.selectAll(client, 'select uniqueId,lastModified,state '
                                 + 'from ' + this.tablename + '_journal where '
                                 + 'lastModified >= ?', [lastModified])
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

    _insertInternal: function(client, uniqueId, lastModified, state) {
        return sql.insertOne(client, 'insert or replace into ' + this.tablename +
                             ' (uniqueId, lastModified, state) ' +
                             ' values(?, ?, ?)', [uniqueId, lastModified, state])
            .then(function() {
                return sql.insertOne(client, 'insert or replace into ' + this.tablename + '_journal'
                                     + ' (uniqueId, lastModified, state) ' +
                                     'values(?, ?, ?)', [uniqueId, lastModified, state]);
            }.bind(this))
            .then(function() {
                return this._scheduleJournalCleanup();
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
                    return Q.all(data.map(function(d) {
                        var uniqueId = d.uniqueId;
                        var lastModified = d.lastModified;
                        var state = d.state;

                        return self._insertInternal(client, uniqueId, lastModified, state);
                    }));
                });
        });
    },

    _insertIfRecentInternal: function(client, uniqueId, lastModified, state) {
        return sql.selectAll(client, 'select lastModified from '
                             + this.tablename + '_journal where uniqueId = ?',
                             [uniqueId])
            .then(function(rows) {
                if (rows.length > 0 && rows[0].lastModified > lastModified)
                    return false;

                return this._insertInternal(client, uniqueId, lastModified, state).then(function() {
                    return true;
                });
            }.bind(this));
    },

    insertIfRecent: function(uniqueId, lastModified, state) {
        var self = this;
        return this._db.withTransaction(function(client) {
            return this._insertIfRecentInternal(client, uniqueId, lastModified, state);
        }.bind(this));
    },

    insertOne: function(state) {
        var self = this;

        return this._db.withTransaction(function(client) {
            var uniqueId = state.uniqueId;
            delete state.uniqueId;
            var now = new Date;
            var strState = JSON.stringify(state);

            return self._insertInternal(client, uniqueId, now, strState);
        });
    },

    _deleteInternal: function(client, uniqueId, lastModified) {
        return sql.insertOne(client, 'delete from ' + this.tablename +
                             ' where uniqueId = ? ', [uniqueId])
            .then(function() {
                return sql.insertOne(client, 'insert or replace into ' + this.tablename + '_journal'
                                     + ' (uniqueId, lastModified, state) ' +
                                     'values(?, ?, ?)', [uniqueId, lastModified, null]);
            }.bind(this))
            .then(function() {
                return this._scheduleJournalCleanup();
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
                if (rows.length > 0 && rows[0].lastModified > lastModified)
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
