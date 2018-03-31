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

// Based on the IndexedDBCryptoStore from the SDK

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

const deq = require('deep-equal');
const sql = require('../../../../db/sqlite');

/**
 * Internal module. indexeddb storage for e2e.
 *
 * @module
 */

/**
 * An implementation of CryptoStore, which is normally backed by an indexeddb,
 * but with fallback to MemoryCryptoStore.
 *
 * @implements {module:crypto/store/base~CryptoStore}
 */
module.exports = class CryptoSqliteStore {
    /**
     * Create a new CryptoSqliteStore
     *
     */
    constructor(db, userId) {
        this._db = db;
        this._userId = userId;
    }

    /**
     * Delete all data from this store.
     *
     * @returns {Promise} resolves when the store has been cleared.
     */
    deleteAllData() {
        return this._db.withTransaction((dbClient) => {
            dbClient.run('delete from matrix_outgoingRoomKeyRequests where owner_id = ?', [this._userId]);
        });
    }

    /**
     * look for an existing room key request in the db
     *
     * @private
     * @param {IDBTransaction} txn  database transaction
     * @param {module:crypto~RoomKeyRequestBody} requestBody
     *    existing request to look for
     * @param {Function} callback  function to call with the results of the
     *    search. Either passed a matching
     *    {@link module:crypto/store/base~OutgoingRoomKeyRequest}, or null if
     *    not found.
     */
    _getOutgoingRoomKeyRequest(dbClient, requestBody) {
        return sql.selectAll(dbClient, 'select object from matrix_outgoingRoomKeyRequests where owner_id = ? and room_id = ? and session_id = ?',
            [this._userId, requestBody.room_id, requestBody.session_id]).then((rows) => {
            if (rows.length === 0)
                return null;

            for (let row of rows) {
                let obj = JSON.parse(row.object);
                if (deq(obj.requestBody, requestBody))
                    return obj;
            }
            return null;
        });
    }

    /**
     * Look for an existing outgoing room key request, and if none is found,
     * add a new one
     *
     * @param {module:crypto/store/base~OutgoingRoomKeyRequest} request
     *
     * @returns {Promise} resolves to
     *    {@link module:crypto/store/base~OutgoingRoomKeyRequest}: either the
     *    same instance as passed in, or the existing one.
     */
    getOrAddOutgoingRoomKeyRequest(request) {
        return this._db.withTransaction((dbClient) => {
            const requestBody = request.requestBody;
            return this._getOutgoingRoomKeyRequest(dbClient, requestBody).then((existing) => {
                if (existing) {
                    // this entry matches the request - return it.
                    console.log(`already have key request outstanding for ` +
                            `${requestBody.room_id} / ${requestBody.session_id}: ` +
                            `not sending another`);
                    return existing;
                }

                // we got to the end of the list without finding a match
                // - add the new request.
                console.log(`enqueueing key request for ${requestBody.room_id} / ${requestBody.session_id}`);

                dbClient.run('insert into matrix_outgoingRoomKeyRequests values(?,?,?,?,?,?)',
                    [this._userId, request.requestId, request.requestBody.room_id, request.requestBody.session_id,
                        request.state, JSON.stringify(request)]);
                return request;
            });
        });
    }

    /**
     * Look for an existing room key request
     *
     * @param {module:crypto~RoomKeyRequestBody} requestBody
     *    existing request to look for
     *
     * @return {Promise} resolves to the matching
     *    {@link module:crypto/store/base~OutgoingRoomKeyRequest}, or null if
     *    not found
     */
    getOutgoingRoomKeyRequest(requestBody) {
        return this._db.withTransaction((dbClient) => {
            return this._getOutgoingRoomKeyRequest(dbClient, requestBody);
        });
    }

    /**
     * Look for room key requests by state
     *
     * @param {Array<Number>} wantedStates list of acceptable states
     *
     * @return {Promise} resolves to the a
     *    {@link module:crypto/store/base~OutgoingRoomKeyRequest}, or null if
     *    there are no pending requests in those states. If there are multiple
     *    requests in those states, an arbitrary one is chosen.
     */
    getOutgoingRoomKeyRequestByState(wantedStates) {
        // make sure wantedStates is clean
        wantedStates = wantedStates.map(Number);
        if (wantedStates.length === 0)
            return Promise.resolve(null);
        return this._db.withTransaction((dbClient) => {
            return sql.selectAll(dbClient, 'select object from matrix_outgoingRoomKeyRequests where owner_id = ? and state in (' + wantedStates + ')',
                [this._userId]);
        }).then((rows) => {
            if (rows.length === 0)
                return null;

            return JSON.parse(rows[0].object);
        });
    }

    /**
     * Look for an existing room key request by id and state, and update it if
     * found
     *
     * @param {string} requestId      ID of request to update
     * @param {number} expectedState  state we expect to find the request in
     * @param {Object} updates        name/value map of updates to apply
     *
     * @returns {Promise} resolves to
     *    {@link module:crypto/store/base~OutgoingRoomKeyRequest}
     *    updated request, or null if no matching row was found
     */
    updateOutgoingRoomKeyRequest(requestId, expectedState, updates) {
        return this._db.withTransaction((dbClient) => {
            return sql.selectAll('select state, object from matrix_outgoingRoomKeyRequests where owner_id = ? and request_id = ?',
                [this._userId, requestId]).then((rows) => {
                if (rows.length === 0)
                    return null;

                let first = rows[0];
                if (first.state !== expectedState) {
                    console.warn(`Cannot update room key request from ${expectedState} as it was already updated to ${first.state}`);
                    return null;
                }
                let obj = JSON.parse(first.object);
                Object.assign(obj, updates);

                dbClient.run('update matrix_outgoingRoomKeyRequests set state = ?, room_id = ?, session_id = ?, object = ? where owner_id =? and request_id =?',
                    [obj.state, obj.requestBody.room_id, obj.requestBody.session_id, JSON.stringify(obj), this._userId, requestId]);
                return obj;
            });
        });
    }

    /**
     * Look for an existing room key request by id and state, and delete it if
     * found
     *
     * @param {string} requestId      ID of request to update
     * @param {number} expectedState  state we expect to find the request in
     *
     * @returns {Promise} resolves once the operation is completed
     */
    deleteOutgoingRoomKeyRequest(requestId, expectedState) {
        return this._db.withTransaction((dbClient) => {
            return sql.selectAll('delete from matrix_outgoingRoomKeyRequests where owner_id = ? and request_id = ? and state = ?',
                [this._userId, requestId, expectedState]);
        });
    }
};
