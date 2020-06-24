// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

// Based on the IndexedDBStore from the SDK

/*
Copyright 2017 Vector Creations Ltd

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

// matrix-js-sdk requires a bluebird compatible promise implementation
// (including a .done() method)
const Q = require('q');

const Matrix = require("matrix-js-sdk");
const MatrixInMemoryStore = Matrix.MatrixInMemoryStore;
const User = Matrix.User;
const MatrixEvent = Matrix.MatrixEvent;
const SyncAccumulator = Matrix.SyncAccumulator;

const sql = require('../../../db/sqlite');

// If this value is too small we'll be writing very often which will cause
// noticable stop-the-world pauses. If this value is too big we'll be writing
// so infrequently that the /sync size gets bigger on reload. Writing more
// often does not affect the length of the pause since the entire /sync
// response is persisted each time.
const WRITE_DELAY_MS = 1000 * 60 * 5; // once every 5 minutes


/**
 * Construct a new sqlite Database store, which extends MatrixInMemoryStore.
 *
 * This store functions like a MatrixInMemoryStore except it periodically persists
 * the contents of the store to an IndexedDB backend.
 *
 * All data is still kept in-memory but can be loaded from disk by calling
 * <code>startup()</code>. This can make startup times quicker as a complete
 * sync from the server is not required. This does not reduce memory usage as all
 * the data is eagerly fetched when <code>startup()</code> is called.
 * <pre>
 * let opts = { localStorage: window.localStorage };
 * let store = new IndexedDBStore();
 * await store.startup(); // load from indexed db
 * let client = sdk.createClient({
 *     store: store,
 * });
 * client.startClient();
 * client.on("sync", function(state, prevState, data) {
 *     if (state === "PREPARED") {
 *         console.log("Started up, now with go faster stripes!");
 *     }
 * });
 * </pre>
 *
 * @constructor
 * @extends MatrixInMemoryStore
 * @param {Object} opts Options object.
 * @param {Object} opts.indexedDB The Indexed DB interface e.g.
 * <code>window.indexedDB</code>
 * @param {string=} opts.dbName Optional database name. The same name must be used
 * to open the same database.
 * @param {string=} opts.workerScript Optional URL to a script to invoke a web
 * worker with to run IndexedDB queries on the web worker. The IndexedDbStoreWorker
 * class is provided for this purpose and requires the application to provide a
 * trivial wrapper script around it.
 * @param {Object=} opts.workerApi The webWorker API object. If omitted, the global Worker
 * object will be used if it exists.
 * @prop {IndexedDBStoreBackend} backend The backend instance. Call through to
 * this API if you need to perform specific indexeddb actions like deleting the
 * database.
 *
 * @private
 */
module.exports = class SqliteStore extends MatrixInMemoryStore {
    constructor(opts) {
        super(opts);

        this._db = opts.db;
        this._userId = opts.userId;
        this.startedUp = false;
        this._syncTs = 0;
        this._syncAccumulator = new SyncAccumulator();

        // Records the last-modified-time of each user at the last point we saved
        // the database, such that we can derive the set if users that have been
        // modified since we last saved.
        this._userModifiedMap = {
            // user_id : timestamp
        };
    }

    /**
     * @return {Promise} Resolved when loaded from indexed db.
     */
    startup() {
        if (this.startedUp)
            return Q();

        return this._connect().then(() => {
            return this._getUserPresenceEvents();
        }).then((userPresenceEvents) => {
            userPresenceEvents.forEach(([userId, rawEvent]) => {
                const u = new User(userId);
                if (rawEvent) 
                    u.setPresenceEvent(new MatrixEvent(rawEvent));
                
                this._userModifiedMap[u.userId] = u.getLastModifiedTime();
                this.storeUser(u);
            });
        });
    }

    _connect() {
        return Q.all([
            this._loadAccountData(),
            this._loadSyncData(),
        ]).then(([accountData, syncData]) => {
            this._syncAccumulator.accumulate({
                next_batch: syncData.nextBatch,
                rooms: syncData.roomsData,
                groups: syncData.groupsData,
                account_data: {
                    events: accountData,
                },
            });
        });
    }

    /**
     * Clear the entire database. This should be used when logging out of a client
     * to prevent mixing data between accounts.
     * @return {Promise} Resolved when the database is cleared.
     */
    clearDatabase() {
        return this._db.withTransaction((dbClient) => {
            dbClient.run("delete from matrix_users where owner_id = ?", [this._userId]);
            dbClient.run("delete from matrix_accountData where owner_id = ?", [this._userId]);
            dbClient.run("delete from matrix_sync where owner_id = ?", [this._userId]);
        });
    }

    /**
     * @param {boolean=} copy If false, the data returned is from internal
     * buffers and must not be muated. Otherwise, a copy is made before
     * returning such that the data can be safely mutated. Default: true.
     *
     * @return {Promise} Resolves with a sync response to restore the
     * client state to where it was at the last save, or null if there
     * is no saved sync data.
     */
    getSavedSync(copy) {
        if (copy === undefined) copy = true;

        const data = this._syncAccumulator.getJSON();
        if (!data.nextBatch) return Q(null);
        if (copy) {
            // We must deep copy the stored data so that the /sync processing code doesn't
            // corrupt the internal state of the sync accumulator (it adds non-clonable keys)
            let obj = JSON.parse(JSON.stringify(data));
            return Q(obj);
        } else {
            return Q(data);
        }
    }

    setSyncData(syncData) {
        return Q().then(() => {
            this._syncAccumulator.accumulate(syncData);
        });
    }

    _syncToDatabase(userTuples) {
        const syncData = this._syncAccumulator.getJSON();

        return this._db.withTransaction((dbClient) => {
            return Q.all([
                this._persistUserPresenceEvents(dbClient, userTuples),
                this._persistAccountData(dbClient, syncData.accountData),
                this._persistSyncData(dbClient, syncData.nextBatch, syncData.roomsData, syncData.groupsData)
            ]);
        });
    }

    /**
     * Persist rooms /sync data along with the next batch token.
     * @param {string} nextBatch The next_batch /sync value.
     * @param {Object} roomsData The 'rooms' /sync data from a SyncAccumulator
     * @param {Object} groupsData The 'groups' /sync data from a SyncAccumulator
     * @return {Promise} Resolves if the data was persisted.
     */
    _persistSyncData(dbClient, nextBatch, roomsData, groupsData) {
        //console.log("Persisting sync data up to ", nextBatch);
        // constant key so will always clobber
        dbClient.run("replace into matrix_sync values(?,?,?)", [this._userId, "-", JSON.stringify({
            nextBatch: nextBatch,
            roomsData: roomsData,
            groupsData: groupsData,
        })]);
    }

    /**
     * Persist a list of account data events. Events with the same 'type' will
     * be replaced.
     * @param {Object[]} accountData An array of raw user-scoped account data events
     * @return {Promise} Resolves if the events were persisted.
     */
    _persistAccountData(dbClient, accountData) {
        for (let i = 0; i < accountData.length; i++) 
            dbClient.run("replace into matrix_accountData values(?,?,?)", [this._userId, accountData[i].type, JSON.stringify(accountData[i])]);
        
    }

    /**
     * Persist a list of [user id, presence event] they are for.
     * Users with the same 'userId' will be replaced.
     * Presence events should be the event in its raw form (not the Event
     * object)
     * @param {Object[]} tuples An array of [userid, event] tuples
     * @return {Promise} Resolves if the users were persisted.
     */
    _persistUserPresenceEvents(dbClient, tuples) {
        for (const tuple of tuples) 
            dbClient.run("replace into matrix_users values(?,?,?)", [this._userId, tuple[0], JSON.stringify(tuple[1])]);
        
    }

    /**
     * Load all user presence events from the database. This is not cached.
     * FIXME: It would probably be more sensible to store the events in the
     * sync.
     * @return {Promise<Object[]>} A list of presence events in their raw form.
     */
    _getUserPresenceEvents() {
        return this._db.withClient((dbClient) => {
            return sql.selectAll(dbClient, "select object_key,object_value from matrix_users where owner_id = ?", [this._userId]);
        }).then((rows) => {
            return rows.map((r) => ([r.object_key, JSON.parse(r.object_value)]));
        });
    }

    /**
     * Load all the account data events from the database. This is not cached.
     * @return {Promise<Object[]>} A list of raw global account events.
     */
    _loadAccountData() {
        return this._db.withClient((dbClient) => {
            return sql.selectAll(dbClient, "select object_key,object_value from matrix_accountData where owner_id = ?", [this._userId]);
        }).then((rows) => {
            return rows.map((r) => {
                let obj = JSON.parse(r.object_value);
                obj.type = r.object_key;
                return obj;
            });
        });
    }

    /**
     * Load the sync data from the database.
     * @return {Promise<Object>} An object with "roomsData" and "nextBatch" keys.
     */
    _loadSyncData() {
        return this._db.withClient((dbClient) => {
            return sql.selectAll(dbClient, "select object_key,object_value from matrix_sync where owner_id = ?", [this._userId]);
        }).then((rows) => {
            if (rows.length > 1) 
                console.warn("loadSyncData: More than 1 sync row found.");
            
            if (rows.length < 1)
                return {};
            let row = rows[0];
            let obj = JSON.parse(row.object_value);
            return obj;
        });
    }

    /**
     * Delete all data from this store.
     * @return {Promise} Resolves if the data was deleted from the database.
     */
    deleteAllData() {
        MatrixInMemoryStore.prototype.deleteAllData.call(this);
        return this._clearDatabase().then(() => {
            console.log("Deleted sqlite data.");
        }, (err) => {
            console.error(`Failed to delete sqlite data: ${err}`);
            throw err;
        });
    }

    /**
     * Possibly write data to the database.
     * @return {Promise} Promise resolves after the write completes.
     */
    save() {
        const now = Date.now();
        if (now - this._syncTs > WRITE_DELAY_MS) 
            return this._reallySave();
        
        return Q();
    }

    _reallySave() {
        this._syncTs = Date.now(); // set now to guard against multi-writes

        // work out changed users (this doesn't handle deletions but you
        // can't 'delete' users as they are just presence events).
        const userTuples = [];
        for (const u of this.getUsers()) {
            if (this._userModifiedMap[u.userId] === u.getLastModifiedTime()) continue;
            if (!u.events.presence) continue;

            userTuples.push([u.userId, u.events.presence.event]);

            // note that we've saved this version of the user
            this._userModifiedMap[u.userId] = u.getLastModifiedTime();
        }

        return this._syncToDatabase(userTuples).catch((err) => {
            console.error("sync fail:", err);
        });
    }
};
