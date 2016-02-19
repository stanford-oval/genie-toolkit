// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const events = require('events');
const fs = require('fs');
const lang = require('lang');
const uuid = require('node-uuid');
const deepEqual = require('deep-equal');

const SyncDatabase = require('./syncdb');
const AppExecutor = require('../app_executor');

const AppTierManager = new lang.Class({
    Name: 'AppTierManager',

    _init: function(tierManager) {
        this._tierManager = tierManager;
    },

    maybeMoveApps: function() {
        // STUB
    },

    chooseTierForApp: function(app) {
        // STUB
        return this._tierManager.ownTier;
    },
});

module.exports = new lang.Class({
    Name: 'AppDatabase',
    Extends: events.EventEmitter,
    $rpcMethods: ['loadOneApp', 'removeApp', 'getAllApps', 'getApp', 'hasApp'],

    _init: function(engine, tierManager) {
        // EventEmitter is a node.js class not a lang class,
        // can't chain up normally
        events.EventEmitter.call(this);

        this._apps = {};

        this._engine = engine;
        this._tierManager = tierManager;
        this._appTierManager = new AppTierManager(tierManager);
        this._syncdb = new SyncDatabase('app', ['code', 'state', 'tier', 'name', 'description'], tierManager);
    },

    loadOneApp: function(code, state, uniqueId, tier, name, description, addToDB) {
        return Q.try(function() {
            var app = new AppExecutor(this._engine, code, state, name, description);
            return this._addAppInternal(app, uniqueId, tier, addToDB);
        }.bind(this)).catch(function(e) {
            console.error('Failed to load one app: ' + e);
            console.error(e.stack);
        });
    },

    start: function() {
        this._objectAddedHandler = this._onObjectAdded.bind(this);
        this._objectDeletedHandler = this._onObjectDeleted.bind(this);

        this._syncdb.on('object-added', this._objectAddedHandler);
        this._syncdb.on('object-deleted', this._objectDeletedHandler);
        this._syncdb.open();
        return this._syncdb.getAll().then(function(rows) {
            return Q.all(rows.map(function(row) {
                try {
                    var code = row.code;
                    var state = JSON.parse(row.state);
                    return this.loadOneApp(code, state, row.uniqueId, row.tier, row.name, row.description, false);
                } catch(e) {
                    console.log('Failed to load one app: ' + e);
                }
            }.bind(this)));
        }.bind(this));
    },

    _appChanged: function(app, newCode, newState, newTier, newName, newDescription) {
        // FIXME: in the future we might have state changes in apps
        // for now, just remove the old instance and add a new one
        var uniqueId = app.uniqueId;
        this._removeAppInternal(uniqueId);
        this.loadOneApp(newCode, newState, uniqueId, newTier, newName, newDescription, false).done();
    },

    _tryEnableApp: function(app) {
        app.isEnabled = (!app.isBroken &&
                         (app.currentTier === this._tierManager.ownTier ||
                          app.currentTier === 'all'));
    },

    _appMoved: function(app, newTier) {
        this._appTierManager.appMoved(app, newTier);

        app.currentTier = tier;
        var currentEnabled = app.isEnabled;
        this._tryEnableApp(app);
        if (currentEnabled !== app.isEnabled)
            this.emit('app-changed', app);
    },

    _onObjectAdded: function(uniqueId, row) {
        var state = JSON.parse(row.state);
        if (uniqueId in this._apps) {
            var currentApp = this._apps[uniqueId];

            if (row.code === currentApp.code &&
                deepEqual(state, currentApp.state, {strict: true})) {
                if (currentApp.currentTier !== row.tier) {
                    this._appMoved(currentApp, row.tier);
                } else {
                    currentApp.updateNameDescription(name, description);
                }
            } else {
                this._appChanged(currentApp, row.code, state, row.tier);
            }
        } else {
            this.loadOneApp(row.code, state, uniqueId, row.tier, row.name, row.description, false).done();
        }
    },

    _onObjectDeleted: function(uniqueId) {
        this._removeAppInternal(uniqueId);
    },

    stop: function() {
        this._syncdb.close();
        return Q();
    },

    _removeAppInternal: function(uniqueId) {
        var app = this._apps[uniqueId];
        delete this._apps[uniqueId];

        if (app !== undefined)
            this.emit('app-removed', app);
    },

    _addAppInternal: function(app, uniqueId, tier, addToDB) {
        if (app.uniqueId === undefined) {
            // HACK: we accept null as well as undefined because undefined
            // is lost by the RPC layer in the cloud case
            if (uniqueId === undefined || uniqueId === null)
                app.uniqueId = 'uuid-' + uuid.v4();
            else
                app.uniqueId = uniqueId;
        } else {
            if ((uniqueId !== undefined && uniqueId !== null) &&
                app.uniqueId !== uniqueId)
                throw new Error('App unique id is different from stored value');
        }

        // pick a tier for this new app if we don't know it yet
        if (tier === undefined) {
            tier = this._appTierManager.chooseTierForApp(app);
            console.log('Chosen tier ' + tier + ' for ' + app.uniqueId);
            if (tier === undefined)
                throw new TypeError("AppTierManager failed");
        }
        app.currentTier = tier;

        this._apps[app.uniqueId] = app;
        this._tryEnableApp(app);

        if (addToDB) {
            var state = app.state;
            var uniqueId = app.uniqueId;
            return this._syncdb.insertOne(uniqueId,
                                          { state: JSON.stringify(state),
                                            code: app.code,
                                            name: app.name,
                                            description: app.description,
                                            tier: tier })
                .then(function() {
                    this.emit('app-added', app);
                }.bind(this));
        } else {
            this.emit('app-added', app);
            return Q();
        }
    },

    removeApp: function(app) {
        this._removeAppInternal(app.uniqueId);
        return this._syncdb.deleteOne(app.uniqueId);
    },

    getAllApps: function() {
        var apps = [];
        for (var id in this._apps)
            apps.push(this._apps[id]);
        return apps;
    },

    getApp: function(id) {
        return this._apps[id];
    },

    hasApp: function(id) {
        return this._apps[id] !== undefined;
    },
});
