// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');
const uuid = require('node-uuid');

const sql = require('../util/sql');
const AppExecutor = require('./app_executor');

module.exports = class AppDatabase extends events.EventEmitter {
    constructor(engine) {
        super();

        this._apps = {};

        this._engine = engine;
        this._db = sql.db(engine.platform.getSqliteDB());
    }

    _getAll() {
        return this._db.withClient(function(client) {
            return sql.selectAll(client, 'select * from app', []);
        });
    }

    _getOne(uniqueId) {
        return this._db.withClient(function(client) {
            return sql.selectOne(client, 'select * from app where uniqueId = ?', [uniqueId]);
        });
    }

    _insertOne(uniqueId, row) {
        console.log('Inserting one app in DB: ' + JSON.stringify(row));
        return this._db.withTransaction(function(client) {
            var insertSql = 'insert or replace into app(uniqueId, code, state, name, description)' +
                ' values(?,?,?,?,?)';
            var param = [uniqueId, row.code, row.state, row.name, row.description];
            return sql.insertOne(client, insertSql, param);
        });
    }

    _deleteOne(uniqueId) {
        console.log('Deleting one app from DB: ' + uniqueId);
        return this._db.withTransaction(function(client) {
            return sql.query(client, 'delete from app where uniqueId = ? ', [uniqueId]);
        });
    }

    loadOneApp(code, state, uniqueId, tier, name, description, addToDB) {
        return Q.try(() => {
            var app = new AppExecutor(this._engine, code, state, name, description);
            return app.compile().then(function() { return app; });
        }).tap((app) => {
            this._addAppInternal(app, uniqueId);
            if (addToDB)
                return app.runCommands();
        }).tap((app) => {
            // only start and save into db apps that actually have some rules
            if (app.rules.length > 0) {
                this._enableApp(app);
                if (addToDB)
                    return this._saveApp(app);
            } else
                this._removeAppInternal(app.uniqueId);
        }).catch(function(e) {
            console.error('Failed to load one app: ' + e);
            console.error(e.stack);
        });
    }

    start() {
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
    }

    stop() {
        return Q();
    }

    _removeAppInternal(uniqueId) {
        var app = this._apps[uniqueId];
        delete this._apps[uniqueId];

        if (app !== undefined)
            this.emit('app-removed', app);
    }

    _addAppInternal(app, uniqueId) {
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
    }

    _enableApp(app) {
        app.isEnabled = true;
        this.emit('app-added', app);
    }

    _saveApp(app) {
        return this._insertOne(app.uniqueId, {
            state: JSON.stringify(app.state),
            code: app.code,
            name: app.name,
            description: app.description
        });
    }

    removeApp(app) {
        this._removeAppInternal(app.uniqueId);
        return this._deleteOne(app.uniqueId);
    }

    getAllApps() {
        var apps = [];
        for (var id in this._apps)
            apps.push(this._apps[id]);
        return apps;
    }

    getApp(id) {
        return this._apps[id];
    }

    hasApp(id) {
        return this._apps[id] !== undefined;
    }
}
module.exports.prototype.$rpcMethods = ['loadOneApp', 'removeApp', 'getAllApps', 'getApp', 'hasApp'];
