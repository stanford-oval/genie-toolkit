// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>

import * as events from 'events';
import * as Tp from 'thingpedia';

import { AbstractDatabase, AbstractRow, SyncRecord, SyncTable, SyncTables } from '.';
import SyncManager from '../sync/manager';

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
type SyncMessage<RowType extends AbstractRow> = ({
    op : 'change';
    uniqueId : string;
    lastModified : number;
    row : Omit<RowType, "uniqueId">|undefined;
} | {
    op : 'sync-request';
    lastSyncTime : number;
    values : Array<SyncRecord<RowType>>;
} | {
    op : 'sync-reply';
    lastModified : number;
    values : Array<SyncRecord<RowType>>;
} | {
    op : 'force-sync';
} | {
    op : 'force-sync-data';
    values : Array<SyncRecord<RowType>>;
} | {
    op : 'do-force-sync'
}) & { target ?: string };

// SyncDatabase is a database that automatically syncs its changes across
// all tiers
export default class SyncDatabase<K extends keyof SyncTables> extends events.EventEmitter {
    private _platform : Tp.BasePlatform;
    private _table : SyncTable<SyncTables[K]>;
    private _syncManager : SyncManager;
    private _debug : boolean;
    private _connectedHandler : (tier : string) => void;

    constructor(platform : Tp.BasePlatform,
                db : AbstractDatabase,
                tablename : K, syncManager : SyncManager) {
        super();
        this._platform = platform;

        this._table = db.getSyncTable(tablename);
        this._syncManager = syncManager;

        this._syncManager.registerHandler('syncdb-' + tablename,
            this._handleMessage.bind(this));

        this._debug = false;

        this._connectedHandler = this._onConnected.bind(this);
    }

    open() {
        this._syncManager.on('connected', this._connectedHandler);

        // sync with the servers that we're connected to
        // sync is always client-driven, because clients generate the
        // bulk of changes and servers are expected to have a more clearer
        // picture of what's right and what not
        const connected = this._syncManager.getClientConnections();
        if (connected.length === 0) {
            if (this._debug)
                console.log('Not connected to any server, not syncing ' + this._table.name);
        } else {
            for (const address of connected)
                this.sync(address);
        }

        return Promise.resolve();
    }

    close() {
        this._syncManager.removeListener('connected', this._connectedHandler);
        return Promise.resolve();
    }

    private _onConnected(tier : string) {
        if (!this._syncManager.isClientTier(tier))
            return;

        this.sync(tier);
    }

    private _handleMessage(fromTier : string, msg : SyncMessage<SyncTables[K]>) {
        switch (msg.op) {
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

    private _sendMessage(targetTier : string, msg : SyncMessage<SyncTables[K]>) {
        //console.log('Sending one message ' + JSON.stringify(msg));
        // target the syncb of the remote tier
        msg.target = 'syncdb-' + this._table.name;
        this._syncManager.sendTo(targetTier, msg);
    }

    private _sendMessageToAll(msg : SyncMessage<SyncTables[K]>) {
        //console.log('Sending one broadcast ' + JSON.stringify(msg));
        // target the syncb of the remote tier
        msg.target = 'syncdb-' + this._table.name;
        this._syncManager.sendToAll(msg);
    }

    private _forceSyncWith(targetTier : string) {
        console.log(`Forcing syncdb full sync for ${this._table.name} with ${targetTier}`);

        this._sendMessage(targetTier, { op: 'force-sync' });
    }

    sync(targetTier : string) {
        const prefs = this._platform.getSharedPreferences();
        const prefName = 'syncdb-time-' + this._table.name + '-' + targetTier;
        let lastSyncTime = prefs.get(prefName) as number|undefined;
        if (lastSyncTime === undefined)
            lastSyncTime = 0;

        if (this._debug)
            console.log(`syncdb sync for ${this._table.name} with ${targetTier} at ${lastSyncTime}`);

        // batch up the changes that happened after lastSyncTime,
        // then ask the server for more
        this._table.getChangesAfter(lastSyncTime).then((changes) => {
            this._sendMessage(targetTier, {
                op:'sync-request',
                lastSyncTime: lastSyncTime!,
                values: changes
            });
        });
    }

    // Called in case of conflicts
    // phone and server sync with cloud, cloud wins the conflict
    private _handleConflict(withTier : string) {
        const ownTier = this._syncManager.ownTier;
        if (ownTier !== Tp.Tier.CLOUD)
            this._forceSyncWith(Tp.Tier.CLOUD);
        else
            this._sendMessage(withTier, { op:'do-force-sync' });
    }

    getAll() {
        return this._table.getAll();
    }

    getOne(uniqueId : string) {
        return this._table.getOne(uniqueId);
    }

    insertOne(uniqueId : string, row : Omit<SyncTables[K], "uniqueId">) {
        if (this._debug)
            console.log('Inserting one object in DB: ' + JSON.stringify(row));
        return this._table.insertOne(uniqueId, row).then((lastModified) => {
            this._sendMessageToAll({
                op:'change',
                uniqueId: uniqueId,
                row: row,
                lastModified: lastModified
            });
        });
    }

    deleteOne(uniqueId : string) {
        if (this._debug)
            console.log('Deleting one object from DB: ' + uniqueId);
        return this._table.deleteOne(uniqueId).then((lastModified) => {
            this._sendMessageToAll({
                op:'change',
                uniqueId: uniqueId,
                row: undefined,
                lastModified: lastModified
            });
        });
    }

    private objectAdded(uniqueId : string, row : Omit<SyncTables[K], "uniqueId">) {
        this.emit('object-added', uniqueId, row);
    }

    private objectDeleted(uniqueId : string) {
        this.emit('object-deleted', uniqueId);
    }

    private _reportChange(fromTier : string,
                          uniqueId : string,
                          lastModified : number,
                          row : Omit<SyncTables[K], "uniqueId">|undefined,
                          done : boolean) {
        if (!done) {
            // stale change
            if (this._debug)
                console.log(`Change for ${uniqueId} in syncdb for ${this._table.name} was stale, ignored`);
            return;
        }

        if (row !== undefined) {
            try {
                this.objectAdded(uniqueId, row);
            } catch(e) {
                console.log('Failed to report syncdb change: ' + e);
            }
        } else {
            this.objectDeleted(uniqueId);
        }
    }

    private _makeRow(change : SyncRecord<SyncTables[K]>) : Omit<SyncTables[K], "uniqueId">|undefined {
        // deletion
        if (change[this._table.fields[0]] === null)
            return undefined;

        const row : any = {};
        for (const f of this._table.fields)
            row[f] = change[f];
        return row;
    }

    private _reportChanges(fromTier : string, changes : Array<SyncRecord<SyncTables[K]>>, done : boolean[]) {
        for (let i = 0; i < changes.length; i++) {
            this._reportChange(fromTier, changes[i].uniqueId,
                changes[i].lastModified, this._makeRow(changes[i]),
                done[i]);
        }
    }

    private _handleChange(fromTier : string, uniqueId : string, lastModified : number, row : Omit<SyncTables[K], "uniqueId">|undefined) {
        if (this._debug)
            console.log(`Received syncdb change for ${this._table.name}: ${row !== undefined ? 'added' : 'deleted'} ${uniqueId}`);

        // version skew between client and server can cause one party or the other
        // to try and delete thingengine-own-* which breaks everything because
        // it loses the sync configuration
        // prevent it from happening
        if (uniqueId === 'thingengine-own-' + this._syncManager.ownAddress) {
            if (this._debug)
                console.log('Ignored change for object under our exclusive control');
            return;
        }

        Promise.resolve().then(() => {
            if (row !== undefined)
                return this._table.insertIfRecent(uniqueId, lastModified, row);
            else
                return this._table.deleteIfRecent(uniqueId, lastModified);
        }).then((done) => {
            this._reportChange(fromTier, uniqueId, lastModified, row, done);
        }).catch((e) => {
            console.log(`Processing syncdb change for ${this._table.name} failed`, e);
            console.log('Forcing a full resync');

            return this._handleConflict(fromTier);
        });
    }

    private _handleSyncReply(fromTier : string, lastModified : number, changes : Array<SyncRecord<SyncTables[K]>>) {
        const prefs = this._platform.getSharedPreferences();
        const prefName = 'syncdb-time-' + this._table.name + '-' + fromTier;
        prefs.set(prefName, lastModified);

        this._table.handleChanges(changes).then((done) => {
            this._reportChanges(fromTier, changes, done);
        }).catch((e) => {
            console.log(`Processing syncdb change for ${this._table.name} failed`, e);
            console.log('Forcing a full resync');

            return this._handleConflict(fromTier);
        });
    }

    private _handleSyncRequest(fromTier : string, lastModified : number, pushedChanges : Array<SyncRecord<SyncTables[K]>>) {
        if (this._debug)
            console.log(`syncdb sync request for ${this._table.name} from ${fromTier} at ${lastModified}`);

        this._table.syncAt(lastModified, pushedChanges).then(({ lastModified, ourChanges, done }) => {
            this._reportChanges(fromTier, pushedChanges, done);
            this._sendMessage(fromTier, {
                op: 'sync-reply',
                lastModified: lastModified,
                values: ourChanges
            });
        });
    }

    private _handleForceSyncData(fromTier : string, data : Array<SyncRecord<SyncTables[K]>>) {
        const prefs = this._platform.getSharedPreferences();
        const prefName = 'syncdb-time-' + this._table.name + '-' + fromTier;
        prefs.set(prefName, (new Date).getTime());

        this._table.replaceAll(data);
    }

    private _handleForceSync(fromTier : string) {
        this._table.getRaw().then((data) => {
            this._sendMessage(fromTier, {
                op: 'force-sync-data',
                values: data
            });
        });
    }
}
