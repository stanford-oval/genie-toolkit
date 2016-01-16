// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const lang = require('lang');
const crypto = require('crypto');
const Url = require('url');
const Tp = require('thingpedia');

const omclient = require('omclient').client;

const OmletMessaging = require('./omlet_messaging');

const API_KEY = '00109b1ea59d9f46d571834870f0168b5ed20005871d8752ff';
const API_SECRET = 'bccb852856c462e748193d6211c730199d62adcf0ba963416fcc715a2db4d76f';

// XOR these comments for testing
//var THINGENGINE_CLOUD_ORIGIN = 'http://127.0.0.1:8080';
var THINGENGINE_CLOUD_ORIGIN = 'https://thingengine.stanford.edu';
// not this one though
var THINGENGINE_LOCAL_ORIGIN = 'http://127.0.0.1:3000';

const DeviceStateStorage = new lang.Class({
    Name: 'DeviceStateStorage',

    _init: function(device, backingObject) {
        this._device = device;
        this._storage = backingObject || {};
        this._stateChangedQueued = false;
    },

    _queueStateChanged: function() {
        if (this._stateChangedQueued)
            return;

        this._stateChangedQueued = true;
        setTimeout(function() {
            if (this._device !== null)
                this._device.stateChanged();
        }.bind(this), 0);
    },

    serialize: function() {
        return this._storage;
    },
    setBackingStorage: function(storage) {
        this._storage = storage;
    },

    key: function(idx) {
        return Object.keys(this._storage)[idx];
    },
    getItem: function(key) {
        return this._storage[key];
    },
    setItem: function(key, value) {
        this._storage[key] = value;
        this._queueStateChanged();
    },
    removeItem: function(key) {
        delete this._storage[key];
        this._queueStateChanged();
    },
    clear: function() {
        this._storage = {};
        this._queueStateChanged();
    }
});

function makeOmletClient(instance, storage, sync) {
    var client = new omclient.Client({ instance: instance,
                                       storage: storage,
                                       sync: sync,
                                       apiKey: { Id: API_KEY, Secret: API_SECRET } });
    client.longdanMessageConsumer.DEBUG = false;
    return client;
}

function findPrimaryIdentity(client) {
    var account = client.account;
    var identities = client._details.Identities;
    var omletId = null;
    var email = null;
    var phone = null;
    for (var i = 0; i < identities.length; i++) {
        var id = identities[i];
        if (id.Type === 'omlet')
            omletId = id.Principal;
        else if (id.Type === 'email' && email === null)
            email = id.Principal;
        else if (id.Type === 'phone' && phone === null)
            phone = id.Principal;
    }
    if (omletId !== null)
        return omletId;
    if (email !== null)
        return email;
    if (phone !== null)
        return phone;
    return account;
}

function runOAuth2Phase1(engine) {
    var buf = crypto.randomBytes(8).toString('hex');
    var storage = new DeviceStateStorage(null, undefined);
    var client = makeOmletClient(buf, storage, false);
    console.log('Obtained omlet Client');

    return Q.try(function() {
        client.enable();

        var origin;
        if (engine.ownTier === 'cloud')
            origin = THINGENGINE_CLOUD_ORIGIN;
        else
            origin = THINGENGINE_LOCAL_ORIGIN;

        return Q.ninvoke(client.auth, 'getAuthPage',
                         origin + '/devices/oauth2/callback/omlet',
                         ['PublicProfile', 'OmletChat']);
    }).then(function(resp) {
        console.log('Obtained omlet auth page response');

        var parsed = Url.parse(resp.Link, true);
        return [resp.Link, { 'omlet-query-key': parsed.query.k,
                             'omlet-instance': buf,
                             'omlet-storage': JSON.stringify(storage.serialize()) }];
    }).finally(function() {
        return client.disable();
    }).catch(function(e) {
        console.log(String(e));
        console.log(e.stack);
        throw e;
    });
}

function runOAuth2Phase2(engine, req) {
    var storageState = JSON.parse(req.session['omlet-storage']);
    var instance = req.session['omlet-instance'];
    var storage = new DeviceStateStorage(null, storageState);
    var client = makeOmletClient(instance, storage, false);
    console.log('Obtained omlet Client');

    var code = req.query.code;
    var key = req.session['omlet-query-key'];

    return Q.Promise(function(callback, errback) {
        client.enable();

        client.onSignedUp = callback;
        client.auth.confirmAuth(code, key);
    }).then(function() {
        return engine.devices.loadOneDevice({ kind: 'omlet',
                                              omletId: findPrimaryIdentity(client),
                                              instance: instance,
                                              storage: storage.serialize() }, true);
    }).finally(function() {
        client.disable();
    });
}

module.exports = new Tp.DeviceClass({
    Name: 'OmletDevice',
    UseOAuth2: function(engine, req) {
        if (req === null)
            return runOAuth2Phase1(engine);
        else
            return runOAuth2Phase2(engine, req);
    },

    _init: function(engine, state) {
        this.parent(engine, state);

        this._updateNameAndDescription();
        this.uniqueId = 'omlet-' + this.omletInstance;

        this._omletStorage = null;
        this._omletClient = null;
        this._omletClientCount = 0;
    },

    _updateNameAndDescription: function() {
        this.name = "Omlet Account of %s".format(this.omletId);
        this.description = "This is your Omlet Account. You can use it to communicate and share data with your friends!";
    },

    updateState: function(newstate) {
        this.parent(newstate);
        if (this._omletStorage !== null)
            this._omletStorage.setBackingStorage(this.state.storage);
    },

    get omletInstance() {
        return this.state.instance;
    },

    get omletId() {
        return this.state.omletId;
    },

    get omletStorage() {
        if (this._omletStorage !== null)
            return this._omletStorage;

        this._omletStorage = new DeviceStateStorage(this, this.state.storage);
        return this._omletStorage;
    },

    get omletClient() {
        if (this._omletClient !== null)
            return this._omletClient;

        this._omletClient = makeOmletClient(this.omletInstance, this.omletStorage, false);
        return this._omletClient;
    },

    refOmletClient: function() {
        var client = this.omletClient;

        if (this._omletClientCount == 0) {
            client.enable();
            var identity = findPrimaryIdentity(client);
            if (identity !== this.state.omletId) {
                console.log('Omlet ID of ' + this.uniqueId + ' changed to ' + identity);
                this.state.omletId = identity;
                this._updateNameAndDescription();
                this.stateChanged();
            }
        }
        this._omletClientCount ++;
        return client;
    },

    unrefOmletClient: function() {
        var client = this.omletClient;

        setTimeout(function() {
            this._omletClientCount --;
            if (this._omletClientCount == 0)
                client.disable();
        }, 5000);
    },

    hasKind: function(kind) {
        switch(kind) {
        case 'online-account':
        case 'messaging':
            return true;
        default:
            return this.parent(kind);
        }
    },

    queryInterface: function(iface) {
        if (iface === 'omlet')
            return this.omletClient;
        else if (iface === 'messaging')
            return new OmletMessaging(this);
        else
            return null;
    },

    checkAvailable: function() {
        return Tp.Availability.AVAILABLE;
    },
});
