// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const events = require('events');
const Q = require('q');
const lang = require('lang');

const SQLDatabase = require('./sqldb');
const Tier = require('../tier_manager').Tier;

// SyncDatabase is a database that automatically syncs its changes across
// all tiers
module.exports = new lang.Class({
    Name: 'SyncDatabase',
    Extends: events.EventEmitter,

    _init: function(tablename, fields, tierManager) {
        this._tierManager = tierManager;

        this._sqldb = new SQLDatabase(platform.getSqliteDB(),
                                      tablename, fields);
        this._tierManager.registerHandler('syncdb-' + tablename,
                                          this._handleMessage.bind(this));

        this._syncing = false;
        this._debug = true;
    },

    open: function() {
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
    },

    close: function() {
        this._tierManager.removeListener('connected', this._connectedHandler);

        return Q();
    },

    _onConnected: function(tier) {
        if (!this._tierManager.isClientTier(tier))
            return;

        this.sync(tier);
    },

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
    _handleMessage: function(fromTier, msg) {
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
    },

    _sendMessage: function(targetTier, msg) {
        //console.log('Sending one message ' + JSON.stringify(msg));
        // target the syncb of the remote tier
        msg.target = 'syncdb-' + this._sqldb.tablename;
        this._tierManager.sendTo(targetTier, msg);
    },

    _sendMessageToAll: function(msg) {
        //console.log('Sending one broadcast ' + JSON.stringify(msg));
        // target the syncb of the remote tier
        msg.target = 'syncdb-' + this._sqldb.tablename;
        this._tierManager.sendToAll(msg);
    },

    _forceSyncWith: function(targetTier) {
        console.log('Forcing syncdb full sync for ' + this._sqldb.tablename
                    + ' with ' + targetTier);

        this._sendMessage(targetTier, {op:'force-sync'});
    },

    sync: function(targetTier) {
        var prefs = platform.getSharedPreferences();
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
    },

    // Called in case of conflicts
    // phone and server sync with cloud, cloud wins the conflict
    _handleConflict: function(withTier) {
        var ownTier = this._tierManager.ownTier;
        if (ownTier != Tier.CLOUD)
            this._forceSyncWith(Tier.CLOUD);
        else
            this._sendMessage(withTier, {op:'do-force-sync'});
    },

    getAll: function() {
        return this._sqldb.getAll();
    },

    getOne: function(uniqueId) {
        return this._sqldb.getOne(uniqueId);
    },

    insertOne: function(uniqueId, row) {
        if (this._debug)
            console.log('Inserting one object in DB: ' + JSON.stringify(row));
        return this._sqldb.insertOne(uniqueId, row)
            .then(function(lastModified) {
                this._sendMessageToAll({op:'change', uniqueId: uniqueId,
                                        row: row,
                                        lastModified: lastModified });
        }.bind(this));
    },

    deleteOne: function(uniqueId) {
        if (this._debug)
            console.log('Deleting one object from DB: ' + uniqueId);
        return this._sqldb.deleteOne(uniqueId).then(function(lastModified) {
            this._sendMessageToAll({op:'change', uniqueId: uniqueId,
                                    row: undefined, lastModified: lastModified });
        }.bind(this));
    },

    objectAdded: function(uniqueId, row) {
        this.emit('object-added', uniqueId, row);
    },

    objectDeleted: function(uniqueId) {
        this.emit('object-deleted', uniqueId);
    },

    _reportChange: function(fromTier, uniqueId, lastModified, row, done) {
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
    },

    _makeRow: function(change) {
        // deletion
        if (change[this._sqldb.fields[0]] === null)
            return undefined;

        var row = {};
        this._sqldb.fields.forEach(function(f) {
            row[f] = change[f];
        });
        return row;
    },

    _reportChanges: function(fromTier, changes, done) {
        for (var i = 0; i < changes.length; i++) {
            this._reportChange(fromTier, changes[i].uniqueId,
                               changes[i].lastModified, this._makeRow(changes[i]),
                               done[i]);
        }
    },

    _handleChange: function(fromTier, uniqueId, lastModified, row) {
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
    },

    _handleSyncReply: function(fromTier, lastModified, changes) {
        var prefs = platform.getSharedPreferences();
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
    },

    _handleSyncRequest: function(fromTier, lastModified, pushedChanges) {
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
    },

    _handleForceSyncData: function(fromTier, data) {
        var prefs = platform.getSharedPreferences();
        var prefName = 'syncdb-time-' + this._sqldb.tablename + '-' + targetTier;
        prefs.set(prefName, (new Date).getTime());

        this._sqldb.replaceAll(data).done();
    },

    _handleForceSync: function(fromTier) {
        this._sqldb.getRaw()
            .then(function(data) {
                this._sendMessage(fromTier,
                                  {op:'force-sync-data', data: data});
            }.bind(this))
            .done();
    },
});
