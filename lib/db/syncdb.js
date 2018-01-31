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

const events = require('events');
const Q = require('q');

const Tp = require('thingpedia');
const Tier = Tp.Tier;
const sql = require('./sqlite');

class SQLDatabase {
    constructor(platform, tablename, fields) {
        this.tablename = tablename;
        this.fields = fields;
        this._discriminator = fields[0];
        this._db = sql.db(platform.getSqliteDB(), platform.getSqliteKey());
    }

    _getLastModifiedInternal(client) {
        return sql.selectAll(client, 'select max(lastModified) as maxLastModified'
                             + ' from ' + this.tablename + '_journal')
            .then(function(rows) {
                if (rows.length == 0 || rows[0].maxLastModified == null) {
                    return 0;
                } else {
                    return rows[0].maxLastModified;
                }
            });
    }

    getAll() {
        return this._db.withClient(function(client) {
            return sql.selectAll(client, 'select uniqueId,' + this.fields.join(',')
                                 + ' from ' + this.tablename, []);
        }.bind(this));
    }

    getOne(uniqueId) {
        return this._db.withClient(function(client) {
            return sql.selectOne(client, 'select uniqueId,' + this.fields.join(',')
                                 + ' from ' + this.tablename
                                 + ' where uniqueId = ?', [uniqueId]);
        }.bind(this));
    }

    getRaw() {
        return this._db.withClient(function(client) {
            return sql.selectAll(client, 'select tj.uniqueId,tj.lastModified,' + ((this.fields.map(function(f) { return 't.' + f; })).join(','))
                                 + ' from ' + this.tablename + '_journal as tj left outer join '
                                 + this.tablename + ' as t on tj.uniqueId = t.uniqueId');
        }.bind(this));
    }

    getChangesAfter(lastModified) {
        return this._db.withClient(function(client) {
            return sql.selectAll(client, 'select tj.uniqueId,tj.lastModified,' + ((this.fields.map(function(f) { return 't.' + f; })).join(','))
                                 + ' from ' + this.tablename + '_journal as tj left outer join '
                                 + this.tablename + ' as t on tj.uniqueId = t.uniqueId where '
                                 + 'tj.lastModified > ?', [lastModified]);
        }.bind(this));
    }

    _handleChangesInternal(client, changes) {
        return Q.all(changes.map(function(change) {
            if (change[this._discriminator] !== null)
                return this._insertIfRecentInternal(client, change.uniqueId,
                                                    change.lastModified, change);
            else
                return this._deleteIfRecentInternal(client, change.uniqueId,
                                                    change.lastModified);
        }.bind(this)));
    }

    handleChanges(changes) {
        return this._db.withTransaction(function(client) {
            // insertIfRecentInternal
            return this._handleChangesInternal(client, changes);
        }.bind(this));
    }

    syncAt(lastModified, pushedChanges) {
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
    }

    _insertInternal(client, uniqueId, lastModified, row) {
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
    }

    replaceAll(data) {
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
    }

    _insertIfRecentInternal(client, uniqueId, lastModified, row) {
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
    }

    insertIfRecent(uniqueId, lastModified, row) {
        var self = this;
        return this._db.withTransaction(function(client) {
            return this._insertIfRecentInternal(client, uniqueId, lastModified, row);
        }.bind(this));
    }

    insertOne(uniqueId, row) {
        var self = this;

        return this._db.withTransaction(function(client) {
            var now = (new Date).getTime();
            return self._insertInternal(client, uniqueId, now, row);
        });
    }

    _deleteInternal(client, uniqueId, lastModified) {
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
    }

    _deleteIfRecentInternal(client, uniqueId, lastModified) {
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
    }

    deleteIfRecent(uniqueId, lastModified) {
        return this._db.withTransaction(function(client) {
            return this._deleteIfRecentInternal(client, uniqueId, lastModified);
        }.bind(this));
    }

    deleteOne(uniqueId) {
        var self = this;

        return this._db.withTransaction(function(client) {
            var now = new Date;
            return self._deleteInternal(client, uniqueId, now);
        });
    }
}

// SyncDatabase is a database that automatically syncs its changes across
// all tiers
module.exports = class SyncDatabase extends events.EventEmitter {
    constructor(platform, tablename, fields, tierManager) {
        super();
        this._platform = platform;
        this._tierManager = tierManager;

        this._sqldb = new SQLDatabase(platform, tablename, fields);
        this._tierManager.registerHandler('syncdb-' + tablename,
                                          this._handleMessage.bind(this));

        this._syncing = false;
        this._debug = false;
    }

    open() {
        this._connectedHandler = this._onConnected.bind(this);
        this._tierManager.on('connected', this._connectedHandler);

        // sync with the servers that we're connected to
        // sync is always client-driven, because clients generate the
        // bulk of changes and servers are expected to have a more clearer
        // picture of what's right and what not
        var connected = this._tierManager.getConnectedClientTiers();
        if (connected.length == 0) {
            console.log('No tier is connected, not syncing ' + this._sqldb.tablename)
        } else {
            for (var i = 0; i < connected.length; i++) {
                this.sync(connected[i]);
            }
        }

        return Q();
    }

    close() {
        this._tierManager.removeListener('connected', this._connectedHandler);

        return Q();
    }

    _onConnected(tier) {
        if (!this._tierManager.isClientTier(tier))
            return;

        this.sync(tier);
    }

    // protocol:
    // change: a single change in otherwise sync'ed dbs, caused by external
    //         forces
    // sync-request: includes all changes in the requestor since the given time,
    //               asks for more changes after the time
    // sync-reply: includes all changes in the message sender since the time
    //             that was requested in sync-request, and includes the last
    //             modification time for the db
    // force-sync: asks for a full dump of the db, because the requestor is
    //             out of sync
    // force-sync-data: the data that force-sync asked for
    // do-force-sync: tells the receipient that it should force sync itself,
    //                because the data it has is corrupt
    _handleMessage(fromTier, msg) {
        switch(msg.op) {
        case 'change':
            this._handleChange(fromTier, msg.uniqueId, msg.lastModified, msg.row);
            break;
        case 'sync-request':
            this._handleSyncRequest(fromTier, msg.lastSyncTime, msg.values);
            break;
        case 'sync-reply':
            this._handleSyncReply(fromTier, msg.lastModified, msg.values);
            break;
        case 'force-sync':
            this._handleForceSync(fromTier);
            break;
        case 'force-sync-data':
            this._handleForceSyncData(fromTier, msg.values);
            break;
        case 'do-force-sync':
            this._forceSyncWith(fromTier);
            break;
        }
    }

    _sendMessage(targetTier, msg) {
        //console.log('Sending one message ' + JSON.stringify(msg));
        // target the syncb of the remote tier
        msg.target = 'syncdb-' + this._sqldb.tablename;
        this._tierManager.sendTo(targetTier, msg);
    }

    _sendMessageToAll(msg) {
        //console.log('Sending one broadcast ' + JSON.stringify(msg));
        // target the syncb of the remote tier
        msg.target = 'syncdb-' + this._sqldb.tablename;
        this._tierManager.sendToAll(msg);
    }

    _forceSyncWith(targetTier) {
        console.log('Forcing syncdb full sync for ' + this._sqldb.tablename
                    + ' with ' + targetTier);

        this._sendMessage(targetTier, {op:'force-sync'});
    }

    sync(targetTier) {
        var prefs = this._platform.getSharedPreferences();
        var prefName = 'syncdb-time-' + this._sqldb.tablename + '-' + targetTier;
        var lastSyncTime = prefs.get(prefName);
        if (lastSyncTime === undefined)
            lastSyncTime = 0;

        console.log('syncdb sync for ' + this._sqldb.tablename
                    + ' with ' + targetTier + ' at ' + lastSyncTime);

        // batch up the changes that happened after lastSyncTime,
        // then ask the server for more
        this._sqldb.getChangesAfter(lastSyncTime)
            .then(function(changes) {
                this._sendMessage(targetTier,
                                  {op:'sync-request', lastSyncTime: lastSyncTime,
                                   values: changes});
            }.bind(this))
            .done();
    }

    // Called in case of conflicts
    // phone and server sync with cloud, cloud wins the conflict
    _handleConflict(withTier) {
        var ownTier = this._tierManager.ownTier;
        if (ownTier != Tier.CLOUD)
            this._forceSyncWith(Tier.CLOUD);
        else
            this._sendMessage(withTier, {op:'do-force-sync'});
    }

    getAll() {
        return this._sqldb.getAll();
    }

    getOne(uniqueId) {
        return this._sqldb.getOne(uniqueId);
    }

    insertOne(uniqueId, row) {
        if (this._debug)
            console.log('Inserting one object in DB: ' + JSON.stringify(row));
        return this._sqldb.insertOne(uniqueId, row)
            .then(function(lastModified) {
                this._sendMessageToAll({op:'change', uniqueId: uniqueId,
                                        row: row,
                                        lastModified: lastModified });
        }.bind(this));
    }

    deleteOne(uniqueId) {
        if (this._debug)
            console.log('Deleting one object from DB: ' + uniqueId);
        return this._sqldb.deleteOne(uniqueId).then(function(lastModified) {
            this._sendMessageToAll({op:'change', uniqueId: uniqueId,
                                    row: undefined, lastModified: lastModified });
        }.bind(this));
    }

    objectAdded(uniqueId, row) {
        this.emit('object-added', uniqueId, row);
    }

    objectDeleted(uniqueId) {
        this.emit('object-deleted', uniqueId);
    }

    _reportChange(fromTier, uniqueId, lastModified, row, done) {
        if (!done) {
            // stale change
            if (this._debug)
                console.log('Change for ' + uniqueId + ' in syncdb for ' + this._sqldb.tablename
                            + ' was stale, ignored');
            return;
        }

        if (row !== undefined) {
            try {
                this.objectAdded(uniqueId, row);
            } catch(e) {
                console.log('Failed to report syncdb change: ' + e);
            }
        } else {
            this.objectDeleted(uniqueId, row);
        }
    }

    _makeRow(change) {
        // deletion
        if (change[this._sqldb.fields[0]] === null)
            return undefined;

        var row = {};
        this._sqldb.fields.forEach(function(f) {
            row[f] = change[f];
        });
        return row;
    }

    _reportChanges(fromTier, changes, done) {
        for (var i = 0; i < changes.length; i++) {
            this._reportChange(fromTier, changes[i].uniqueId,
                               changes[i].lastModified, this._makeRow(changes[i]),
                               done[i]);
        }
    }

    _handleChange(fromTier, uniqueId, lastModified, row) {
        if (this._debug)
            console.log('Received syncdb change for ' + this._sqldb.tablename  + ': '
                        + (row !== undefined ? ' added ' : ' deleted ') + uniqueId);

        Q.try(function() {
            if (row !== undefined) {
                return this._sqldb.insertIfRecent(uniqueId, lastModified,
                                                  row);
            } else {
                return this._sqldb.deleteIfRecent(uniqueId, lastModified);
            }
        }.bind(this)).then(function(done) {
            this._reportChange(fromTier, uniqueId, lastModified, row, done);
        }.bind(this)).catch(function(e) {
            console.log('Processing syncdb change for ' + this._sqldb.tablename  + ': '
                        +  ' failed', e);
            console.log('Forcing a full resync');

            return this._handleConflict(fromTier);
        }.bind(this)).done();
    }

    _handleSyncReply(fromTier, lastModified, changes) {
        var prefs = this._platform.getSharedPreferences();
        var prefName = 'syncdb-time-' + this._sqldb.tablename + '-' + fromTier;
        prefs.set(prefName, lastModified);

        this._sqldb.handleChanges(changes)
            .then(function(done) {
                this._reportChanges(fromTier, changes, done);
            }.bind(this))
            .catch(function(e) {
                console.log('Processing syncdb change for ' + this._sqldb.tablename  + ': '
                        +  ' failed: ' + e);
                console.log('Forcing a full resync');

                return this._handleConflict(fromTier);
            }.bind(this)).done();
    }

    _handleSyncRequest(fromTier, lastModified, pushedChanges) {
        console.log('syncdb sync request for ' + this._sqldb.tablename
                    + ' from ' + fromTier + ' at ' + lastModified);

        this._sqldb.syncAt(lastModified, pushedChanges)
            .spread(function(lastModified, ourChanges, done) {
                this._reportChanges(fromTier, pushedChanges, done);
                this._sendMessage(fromTier,
                                  {op:'sync-reply', lastModified: lastModified,
                                   values: ourChanges});
            }.bind(this))
            .done();
    }

    _handleForceSyncData(fromTier, data) {
        var prefs = this._platform.getSharedPreferences();
        var prefName = 'syncdb-time-' + this._sqldb.tablename + '-' + fromTier;
        prefs.set(prefName, (new Date).getTime());

        this._sqldb.replaceAll(data).done();
    }

    _handleForceSync(fromTier) {
        this._sqldb.getRaw()
            .then(function(data) {
                this._sendMessage(fromTier,
                                  {op:'force-sync-data', data: data});
            }.bind(this))
            .done();
    }
}
