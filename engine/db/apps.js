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

    _init: function(tierManager, appFactory) {
        // EventEmitter is a node.js class not a lang class,
        // can't chain up normally
        events.EventEmitter.call(this);

        this._apps = {};
        this._sharedApps = {};

        this._factory = appFactory;
        this._tierManager = tierManager;
        this._appTierManager = new AppTierManager(tierManager);
        this._syncdb = new SyncDatabase('app', ['state', 'tier'], tierManager);
    },

    loadOneApp: function(serializedApp, tier, addToDB) {
        return Q.try(function() {
            return this._factory.createApp(serializedApp.kind, serializedApp);
        }.bind(this)).then(function(app) {
            this._addAppInternal(app, tier, serializedApp, addToDB);
        }.bind(this)).catch(function(e) {
            console.error('Failed to load one app: ' + e);
            console.error(e.stack);
        });
    },

    load: function() {
        this._objectAddedHandler = this._onObjectAdded.bind(this);
        this._objectDeletedHandler = this._onObjectDeleted.bind(this);

        this._syncdb.on('object-added', this._objectAddedHandler);
        this._syncdb.on('object-deleted', this._objectDeletedHandler);
        this._syncdb.open();
        return this._syncdb.getAll().then(function(rows) {
            return Q.all(rows.map(function(row) {
                try {
                    var serializedApp = JSON.parse(row.state);
                    serializedApp.uniqueId = row.uniqueId;
                    return this.loadOneApp(serializedApp, row.tier, false);
                } catch(e) {
                    console.log('Failed to load one app: ' + e);
                }
            }.bind(this)));
        }.bind(this));
    },

    _appChanged: function(app, newState, newTier) {
        // FIXME: in the future we might have state changes in apps
        // for now, just remove the old instance and add a new one
        var uniqueId = app.uniqueId;
        this._removeAppInternal(uniqueId);
        newState.uniqueId = uniqueId;
        this.loadOneApp(newState, newTier, false).done();
    },

    _tryEnableApp: function(app) {
        app.isEnabled = app.currentTier === this._tierManager.ownTier;
        if (app.isEnabled && !app.isSupported) {
            this._appTierManager.appMoveFailed(app);
            app.isEnabled = false;
        }
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
        var serializedApp = JSON.parse(row.state);
        if (uniqueId in this._apps) {
            var currentApp = this._apps[uniqueId];

            if (deepEqual(serializedApp, currentApp.serialize(), {strict: true})) {
                if (currentApp.currentTier !== row.tier) {
                    this._appMoved(currentApp, row.tier);
                }
            } else {
                this._appChanged(currentApp, serializedApp, row.tier);
            }
        } else {
            serializedApp.uniqueId = uniqueId;
            this.loadOneApp(serializedApp, row.tier, false).done();
        }
    },

    _onObjectDeleted: function(uniqueId) {
        this._removeAppInternal(uniqueId);
    },

    save: function() {
        // database is always saved, nothing to do here
        this._syncdb.close();
    },

    _removeAppInternal: function(uniqueId) {
        var app = this._apps[uniqueId];
        delete this._apps[uniqueId];

        if (app !== undefined) {
            if (app.sharedId !== undefined)
                delete this._sharedApps[app.sharedId];
            this.emit('app-removed', app);
        }
    },

    _addAppInternal: function(app, tier, serializedApp, addToDB) {
        if (app.uniqueId === undefined) {
            if (serializedApp === undefined || serializedApp.uniqueId === undefined)
                app.uniqueId = 'uuid-' + uuid.v4();
            else
                app.uniqueId = serializedApp.uniqueId;
        } else {
            if (serializedApp.uniqueId !== undefined &&
                app.uniqueId !== serializedApp.uniqueId)
                throw new Error('App unique id is different from stored value');
        }

        // pick a tier for this new app if we don't know it yet
        if (tier === undefined)
            tier = this._appTierManager.chooseTierForApp(app);
        app.currentTier = tier;

        this._apps[app.uniqueId] = app;
        if (app.sharedId !== undefined) {
            if (app.sharedId in this._sharedApps)
                throw new Error('Multiple instances of shared app ' + app.sharedId);
            this._sharedApps[app.sharedId] = app;
        }

        this._tryEnableApp(app);

        if (addToDB) {
            var state = app.serialize();
            var uniqueId = app.uniqueId;
            return this._syncdb.insertOne(uniqueId,
                                          { state: JSON.stringify(state),
                                            tier: tier })
                .then(function() {
                    this.emit('app-added', app);
                }.bind(this));
        } else {
            this.emit('app-added', app);
            return Q();
        }
    },

    addApp: function(app) {
        this._addAppInternal(app, undefined, undefined, true);
    },

    removeApp: function(app) {
        this._removeAppInternal(app);
        return this._syncdb.deleteOne(app.uniqueId);
    },

    getAllApps: function() {
        var apps = [];
        for (var id in this._apps)
            apps.push(this._apps[id]);
        return apps;
    },

    getSharedApp: function(id) {
        if (!(id in this._sharedApps))
            throw new Error(id + ' is not a shared app');
        return this._sharedApps[id];
    }
});
