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

const AppDatabase = new lang.Class({
    Name: 'AppDatabase',

    _init: function() {
        this._factory = null;
        this._apps = [];
        this._appMap = {};
        this._sharedApps = {};
    },

    setFactory: function(factory) {
        this._factory = factory;
    },

    _loadOneApp: function(serializedApp) {
        return Q.try(function() {
            if ('kind' in serializedApp)
                return this._factory.createApp(serializedApp.kind, serializedApp);
            else // legacy Rulepedia support
                return this._factory.createApp('ifttt', serializedApp);
        }.bind(this)).then(function(app) {
            this._addAppInternal(app, serializedApp);
        }.bind(this)).catch(function(e) {
            console.error('Failed to load one app: ' + e);
            console.error(e.stack);
        });
    },

    load: function() {
        // load the rule db from... somewhere
        throw new Error('Not implemented');
    },

    save: function() {
        // save the device db... somewhere
        throw new Error('Not implemented');
    },

    _addAppInternal: function(app, serializedApp) {
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

        this._appMap[app.uniqueId] = app;
        this._apps.push(app);
        if (app.sharedId !== undefined) {
            if (app.sharedId in this._sharedApps)
                throw new Error('Multiple instances of shared app ' + app.sharedId);
            this._sharedApps[app.sharedId] = app;
        }
    },

    addApp: function(app) {
        this._addAppInternal(app);
    },

    getAllApps: function() {
        return this._apps;
    },

    getSupportedApps: function() {
        return this._apps.filter(function(a) {
            return a.isSupported;
        });
    },

    getApp: function(id) {
        return this._appMap[id];
    },

    getSharedApp: function(id) {
        if (!(id in this._sharedApps))
            throw new Error(id + ' is not a shared app');
        return this._sharedApps[id];
    }
});

const FileAppDatabase = new lang.Class({
    Name: 'FileAppDatabase',
    Extends: AppDatabase,

    _init: function(file) {
        this.parent();
        this._file = file;
    },

    load: function() {
        return Q.nfcall(fs.readFile, this._file)
            .then(function(data) {
                return Q.all(JSON.parse(data).map(function(serializedApp) {
                    return this._loadOneApp(serializedApp);
                }.bind(this)));
            }.bind(this))
            .catch(function(e) {
                if (e.code != 'ENOENT')
                    throw e;
            }.bind(this));
    },

    save: function() {
        var data = JSON.stringify(this.getAllApps().map(function(a) {
            var state = a.serialize();
            if (state.uniqueId === undefined)
                state.uniqueId = a.uniqueId;
            return state;
        }));
        return Q.nfcall(fs.writeFile, this._file, data);
    },
});

module.exports = {
    AppDatabase: AppDatabase,
    FileAppDatabase: FileAppDatabase
}
