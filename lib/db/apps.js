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

const sql = require('./sql');
const AppExecutor = require('../app_executor');

module.exports = new lang.Class({
    Name: 'AppDatabase',
    Extends: events.EventEmitter,
    $rpcMethods: ['loadOneApp', 'removeApp', 'getAllApps', 'getApp', 'hasApp'],

    _init: function(engine) {
        events.EventEmitter.call(this);

        this._apps = {};

        this._engine = engine;
        this._db = sql.db(platform.getSqliteDB());
    },

    _getAll: function() {
        return this._db.withClient(function(client) {
            return sql.selectAll(client, 'select * from app', []);
        });
    },

    _getOne: function(uniqueId) {
        return this._db.withClient(function(client) {
            return sql.selectOne(client, 'select * from app where uniqueId = ?', [uniqueId]);
        });
    },

    _insertOne: function(uniqueId, row) {
        console.log('Inserting one app in DB: ' + JSON.stringify(row));
        return this._db.withTransaction(function(client) {
            var insertSql = 'insert or replace into app(uniqueId, code, state, name, description)' +
                ' values(?,?,?,?,?)';
            var param = [uniqueId, row.code, row.state, row.name, row.description];
            return sql.insertOne(client, insertSql, param);
        });
    },

    _deleteOne: function(uniqueId) {
        console.log('Deleting one app from DB: ' + uniqueId);
        return this._db.withTransaction(function(client) {
            return sql.query(client, 'delete from app where uniqueId = ? ', [uniqueId])
                .then(function() {
                    return sql.query(client, 'delete from keyword where uniqueId like ?',
                                     [uniqueId + '-' + '%']);
                });
        });
    },

    loadOneApp: function(code, state, uniqueId, tier, name, description, addToDB) {
        return Q.try(function() {
            var app = new AppExecutor(this._engine, code, state, name, description);
            return this._addAppInternal(app, uniqueId, addToDB);
        }.bind(this)).catch(function(e) {
            console.error('Failed to load one app: ' + e);
            console.error(e.stack);
        });
    },

    start: function() {
        return this._getAll().then(function(rows) {
            return Q.all(rows.map(function(row) {
                try {
                    var code = row.code;
                    var state = JSON.parse(row.state);
                    return this.loadOneApp(code, state, row.uniqueId, undefined, row.name, row.description, false);
                } catch(e) {
                    console.log('Failed to load one app: ' + e);
                }
            }.bind(this)));
        }.bind(this));
    },

    stop: function() {
        return Q();
    },

    _removeAppInternal: function(uniqueId) {
        var app = this._apps[uniqueId];
        delete this._apps[uniqueId];

        if (app !== undefined)
            this.emit('app-removed', app);
    },

    _addAppInternal: function(app, uniqueId, addToDB) {
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

        if (this._apps[app.uniqueId])
            throw new Error('Multiple apps with the same ID, delete one first');

        this._apps[app.uniqueId] = app;
        app.isEnabled = true;

        if (addToDB) {
            var state = app.state;
            var uniqueId = app.uniqueId;
            return this._insertOne(uniqueId,
                                   { state: JSON.stringify(state),
                                     code: app.code,
                                     name: app.name,
                                     description: app.description })
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
        return this._deleteOne(app.uniqueId);
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
