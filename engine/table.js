// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const fs = require('fs');
const path = require('path');
const events = require('events');
const lang = require('lang');
const adt = require('adt');
const Lokijs = require('lokijs');
const deepEqual = require('deep-equal');

const AppCompiler = require('./app_compiler');
const AppGrammar = require('./app_grammar');
const ExecEnvironment = require('./exec_environment');
const QueryRunner = require('./query_runner');
const BaseChannel = require('./base_channel');
const BaseDevice = require('./base_device');

const ThingEngineFSAdapter = new lang.Class({
    Name: 'ThingEngineFSAdapter',

    _init: function() {},

    loadDatabase: function(dbname, callback) {
        fs.readFile(path.join(platform.getWritableDir(), dbname), {
            encoding: 'utf8'
        }, function readFileCallback(err, data) {
            if (err) {
                callback(err);
            } else {
                callback(data);
            }
        });
    },

    saveDatabase: function(dbname, dbstring, callback) {
        fs.writeFile(path.join(platform.getWritableDir(), dbname), dbstring, callback);
    },
});

const Table = new lang.Class({
    Name: 'Table',
    Extends: Lokijs,

    _init: function(uniqueId) {
        Lokijs.call(this, uniqueId, { autosave: true, autosaveInterval: 10000,
                                      adapter: new ThingEngineFSAdapter() });

        this._refCount = 0;
        this._openPromise = null;
        this._closePromise = null;
    },

    open: function() {
        if (this._openPromise !== null)
            return this._openPromise;
        if (this._closePromise !== null) {
            return this._closePromise.then(function() {
                return this.open();
            }.bind(this));
        }
        if (this._refCount > 0)
            return Q();
        this._refCount ++;
        this._openPromise = Q.ninvoke(this, 'loadDatabase', {}).then(function() {
            if (!this.getCollection('data'))
                this.addCollection('data');
            this._openPromise = null;
        }.bind(this)).catch(function(e) {
            this._openPromise = null;
            if (e.code === 'ENOENT') {
                this.addCollection('data');
                return;
            } else {
                throw e;
            }
        }.bind(this));
        return this._openPromise;
    },

    close: function() {
        if (this._openPromise !== null) {
            return this._openPromise.then(function() {
                return this.close();
            }.bind(this));
        }
        if (this._refCount > 1) {
            this._refCount--;
            return Q();
        }
        this._refCount--;
        if (this._closePromise)
            return this._closePromise;
        this._closePromise = Q.ninvoke(this, 'saveDatabase').then(function() {
            this._closePromise = null;
        }.bind(this));
        return this._closePromise;
    }
});

const CurrentTableChannel = new lang.Class({
    Name: 'CurrentTableChannel',
    Extends: BaseChannel,

    _init: function(engine, device) {
        this.parent();
        this.engine = engine;
        this.device = device;

        this.uniqueId = device.uniqueId + '-alldata';

        this._eventListener = this._onEvent.bind(this);
    },

    _onEvent: function() {
        console.log('Event on table ' + this.uniqueId);
        this.setCurrentEvent(this._collection.find());
    },

    _doOpen: function() {
        this._table = this.device.table;

        return this._table.open().then(function() {
            this._collection = this._table.getCollection('data');
            this._collection.on('insert', this._eventListener);
            this._collection.on('update', this._eventListener);
            this._collection.on('delete', this._eventListener);

            this._onEvent();
        }.bind(this));
    },

    _doClose: function() {
        this._collection.removeListener('insert', this._eventListener);
        this._collection.removeListener('update', this._eventListener);
        this._collection.removeListener('delete', this._eventListener);

        return this._table.close();
    },
});

const OnInsertTableChannel = new lang.Class({
    Name: 'OnInsertTableChannel',
    Extends: BaseChannel,

    _init: function(engine, device) {
        this.parent();
        this.engine = engine;
        this.device = device;

        this.uniqueId = device.uniqueId + '-oninsert';

        this._eventListener = this._onEvent.bind(this);
    },

    _onEvent: function(data) {
        console.log('Event on table ' + this.uniqueId);
        console.log('data', data);
        setTimeout(function() {
            this.emitEvent(data);
        }.bind(this), 0);
    },

    _doOpen: function() {
        this._table = this.device.table;

        return this._table.open().then(function() {
            this._collection = this._table.getCollection('data');
            this._collection.on('insert', this._eventListener);
            this._collection.on('update', this._eventListener);

            //this.emitEvent(this._collection.find());
        }.bind(this));
    },

    _doClose: function() {
        this._collection.removeListener('insert', this._eventListener);
        this._collection.removeListener('update', this._eventListener);

        return this._table.close();
    },
});

const InsertTableChannel = new lang.Class({
    Name: 'InsertTableChannel',
    Extends: BaseChannel,

    _init: function(engine, device) {
        this.parent();
        this.engine = engine;
        this.device = device;

        this.uniqueId = device.uniqueId + '-insert';
    },

    sendEvent: function(event) {
        var previous;
        if (event.key_) {
            var key = event.key_;
            delete event.key_;

            var template = {};
            template[key] = event[key];
            previous = this._collection.findObject(template);
        } else {
            previous = this._collection.findObject(event);
        }
        if (previous) {
            var equal = true;
            for (var name in event) {
                if (!deepEqual(event[name], previous[name], { strict: true }))
                    equal = false;
                previous[name] = event[name];
            }
            if (equal) {
                console.log('Event is same as previous');
                return;
            }
            this._collection.update(previous);
        } else {
            this._collection.insert(event);
        }
    },

    _doOpen: function() {
        this._table = this.device.table;
        return this._table.open().then(function() {
            this._collection = this._table.getCollection('data');
        }.bind(this));
    },

    _doClose: function() {
        return this._table.close();
    },
});

const DeleteTableChannel = new lang.Class({
    Name: 'DeleteTableChannel',
    Extends: BaseChannel,

    _init: function(engine, device) {
        this.parent();
        this.engine = engine;
        this.device = device;

        this.uniqueId = device.uniqueId + '-delete';
    },

    sendEvent: function(event) {
        this._collection.remove(event);
    },

    _doOpen: function() {
        this._table = this.device.table;
        return this._table.open().then(function() {
            this._collection = this._table.getCollection('data');
        }.bind(this));
    },

    _doClose: function() {
        return this._table.close();
    },
});

module.exports = new lang.Class({
    Name: 'TableDevice',
    Extends: BaseDevice,

    _init: function(engine, app, name, schema) {
        this.parent(engine, { kind: 'thingengine-table' });
        this.engine = engine;
        this.app = app;

        this.uniqueId = 'thingengine-table-' + app.uniqueId + '-' + name;

        // this device is stored in AppDatabase not DeviceDatabase
        this.isTransient = true;

        this._table = null;
    },

    get ownerTier() {
        // FIXME: what if the app is migrated?
        return this.app.currentTier;
    },

    get table() {
        if (this._table === null)
            this._table = new Table(this.uniqueId);
        return this._table;
    },

    checkAvailable: function() {
        return BaseDevice.Availability.AVAILABLE;
    },

    verifyGroupAuthorization: function(feed) {
        // FIXME hardcoded
        var groupId = this.app.state['g'];

        if (groupId === undefined)
            return false;

        if (!this.engine.devices.hasDevice(groupId)) {
            console.log('Missing authentication device');
            return false;
        }
        var group = this.engine.devices.getDevice(groupId);
        if (!group.hasKind('messaging-group'))
            return false;
        if (group.feedId === feed.feedId) {
            console.log('Found valid authorization source');
            return true;
        }

        return false;
    },

    getChannel: function(id, filters) {
        var ch;

        // FIXME: proxy channels

        switch(id) {
        case 'alldata':
            ch = new CurrentTableChannel(this.engine, this);
            break;
        case 'oninsert':
            ch = new OnInsertTableChannel(this.engine, this);
            break;
        case 'insert':
            ch = new InsertTableChannel(this.engine, this);
            break;
        case 'delete':
            ch = new DeleteTableChannel(this.engine, this);
            break;
        default:
            throw new TypeError('Invalid channel name ' + id);
        }

        return ch.open().then(function() {
            return ch;
        });
    },

    start: function() {
        return Q(this.engine.devices.addDevice(this));
    },

    stop: function() {
        return Q(this.engine.devices.removeDevice(this));
    }
});
