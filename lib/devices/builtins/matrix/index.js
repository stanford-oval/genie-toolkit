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

global.Olm = require('olm');
const Q = require('q');
const Tp = require('thingpedia');
const Matrix = require("matrix-js-sdk");

const sql = require('../../../../db/sqlite');
const SqliteStore = require('./sqlitestore');
const CryptoSqliteStore = require('./cryptosqlitestore');

const HOMESERVER_URL = process.env.MATRIX_HOMESERVER_URL || 'https://matrix.org';
const IDENTITY_SERVER_URL = process.env.MATRIX_IDENTITY_SERVER_URL || 'https://matrix.org';

const MatrixMessaging = require('./matrix_messaging');

class DeviceStateStorage {
    constructor(device, backingObject) {
        this._device = device;
        this._storage = backingObject || {};
        this._stateChangedQueued = false;
    }

    _queueStateChanged() {
        if (this._stateChangedQueued)
            return;

        this._stateChangedQueued = true;
        setTimeout(() => {
            if (this._device !== null)
                this._device.stateChanged();
        }, 0);
    }

    serialize() {
        return this._storage;
    }

    setBackingStorage(storage) {
        this._storage = storage;
    }

    get length() {
        return Object.keys(this._storage).length;
    }
    key(idx) {
        return Object.keys(this._storage)[idx];
    }
    getItem(key) {
        if (!this._storage.hasOwnProperty(key))
            return null;
        return this._storage[key];
    }
    setItem(key, value) {
        this._storage[key] = value;
        this._queueStateChanged();
    }
    removeItem(key) {
        delete this._storage[key];
        this._queueStateChanged();
    }
    clear() {
        this._storage = {};
        this._queueStateChanged();
    }
}

function makeMatrixClient(userId, deviceId, platform, storage, accessToken) {
    let db = sql.db(platform.getSqliteDB(), platform.getSqliteKey());
    let ownerId = userId + '/' + deviceId;

    let store = new SqliteStore({ userId: ownerId, db: db });
    return Q(store.startup()).then(() => {
        let matrixClient = Matrix.createClient({
            baseUrl: HOMESERVER_URL,
            idBaseUrl: IDENTITY_SERVER_URL,
            store: store,
            sessionStore: new Matrix.WebStorageSessionStore(storage),
            cryptoStore: new CryptoSqliteStore(db, ownerId),
            userId: userId,
            deviceId: deviceId,
            accessToken: accessToken
        });
        matrixClient.initCrypto();
        return matrixClient;
    });
}

function makeRequest(path, data) {
    return Tp.Helpers.Http.post(HOMESERVER_URL + path, JSON.stringify(data), {
        ignoreErrors: true,
        dataContentType: 'application/json',
    }).then((response) => JSON.parse(response));
}

function toIdentity(medium, address) {
    if (medium === 'msisdn')
        return 'phone:+' + address;
    else
        return medium + ':' + address;
}

function configureFromAlmond(engine, delegate) {
    // NOTE: if you change the sentences used here, make sure to change tests/create_test_users.js
    // in platform-cmdline

    return Q(delegate.requestCode(engine._("Insert your email address or phone number:"))).then((identity) => {
        let identityType = 'phone';
        if (identity.indexOf('@') > 0)
            identityType = 'email';
        else if (!identity.startsWith('+') && !identity.startsWith('1'))
            identity = '+1' + identity.replace(/^[0-9]/g, '');
        let medium, address;
        if (identityType === 'phone') {
            medium = 'msisdn';
            address = identity.replace('+', '');
        } else {
            medium = identityType;
            address = identity;
        }

        return Q(delegate.requestCode(engine._("Insert your password:"))).then((password) => {

                return makeRequest('/_matrix/client/r0/login', {
                    type: 'm.login.password',
                    identifier: {
                        type: 'm.id.thirdparty',
                        medium,
                        address
                    },
                    password
                });
        }).then((response) => {
            if (response.errcode)
                throw new Error(engine._("Authentication failed: %s").format(response.error));

            return Tp.Helpers.Http.get('/_matrix/client/r0/account/3pid?access_token=' + encodeURIComponent(response.access_token)).then((threepidres) => {
                threepidres = JSON.parse(threepidres);

                return engine.devices.loadOneDevice({ kind: 'org.thingpedia.builtin.matrix',
                                                      identities: threepidres.map((threepid) => toIdentity(threepid.medium, threepid.address)),
                                                      userId: response.user_id,
                                                      accessToken: response.access_token,
                                                      refreshToken: response.refresh_token,
                                                      homeServer: response.home_server,
                                                      deviceId: response.device_id,
                                                      storage: {} }, true);
            }).catch((e) => {
                // ignore errors in this call

                return engine.devices.loadOneDevice({ kind: 'org.thingpedia.builtin.matrix',
                                                      identities: [identityType + ':' + identity],
                                                      userId: response.user_id,
                                                      accessToken: response.access_token,
                                                      refreshToken: response.refresh_token,
                                                      homeServer: response.home_server,
                                                      deviceId: response.device_id,
                                                      storage: {} }, true);
            });
        });
    });
}

module.exports = class MatrixDevice extends Tp.BaseDevice {
    static runOAuth2(engine, req) {
        throw new Error('Not implemented yet');
    }
    static configureFromAlmond(engine, delegate) {
        return configureFromAlmond(engine, delegate);
    }

    constructor(engine, state) {
        super(engine, state);

        this._updateNameAndDescription();
        this.uniqueId = 'org.thingpedia.builtin.matrix-' + this.userId;

        this._matrixClient = null;
        this._matrixClientCount = 0;
        this._matrixStorage = new DeviceStateStorage(this, this.state.storage);
        this._matrixMessaging = new MatrixMessaging(this);
        this.identities = this.state.identities.concat(['matrix-account:' + this.userId]);
    }

    get ownerTier() {
        return Tp.Tier.GLOBAL;
    }

    _updateNameAndDescription() {
        this.name = this.engine._("Matrix Account of %s").format(this.userId);
        this.description = this.engine._("This is your Matrix Account.");
    }

    updateState(newstate) {
        super.updateState(newstate);
        this._updateNameAndDescription();
        this.identities = this.state.identities.concat(['matrix-account:' + this.userId]);
        this._matrixStorage.setBackingStorage(this.state.storage);
    }

    get userId() {
        return this.state.userId;
    }
    get accessToken() {
        return this.state.accessToken;
    }
    get refreshToken() {
        return this.state.refreshToken;
    }

    refMatrixClient() {
        if (this._matrixClientCount > 0) {
            this._matrixClientCount++;
            return Q(this._matrixClient);
        }

        this._matrixClientCount ++;
        if (this._matrixClient) // still alive because of the 5s timeout after the last unref
            return this._matrixClient;

        return this._matrixClient = makeMatrixClient(this.userId, this.state.deviceId, this.engine.platform, this._matrixStorage, this.accessToken);
    }

    unrefMatrixClient() {
        this._matrixClientCount --;
        if (this._matrixClientCount > 0)
            return;

        setTimeout(() => {
            if (this._matrixClientCount === 0) {
                Q(this._matrixClient).then((client) => client.stopClient());
                this._matrixClient = null;
            }
        }, 5000);
    }

    queryInterface(iface) {
        switch(iface) {
        case 'messaging':
            return this._matrixMessaging;
        default:
            return null;
        }
    }

    checkAvailable() {
        return Tp.Availability.AVAILABLE;
    }

    getTriggerClass(name) {
        throw new Error('Invalid channel name ' + name);
    }

    getActionClass(name) {
        throw new Error('Invalid channel name ' + name);
    }
};
