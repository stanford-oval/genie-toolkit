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

    _init: function(root) {
        this._factory = null;
        this._apps = [];
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
            this.addApp(app);
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

    addApp: function(app) {
        this._apps.push(app);
        if (app.sharedId !== undefined) {
            if (app.sharedId in this._sharedApps)
                throw new Error('Multiple instances of shared app ' + app.sharedId);
            this._sharedApps[app.sharedId] = app;
        }
    },

    getAllApps: function() {
        return this._apps;
    },

    getSupportedApps: function() {
        return this._apps.filter(function(a) {
            return a.isSupported;
        });
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
        var data = JSON.stringify(this.getAllApps().map(function(a) { return a.serialize(); }));
        return Q.nfcall(fs.writeFile, this._file, data);
    },
});

const DeviceDatabase = new lang.Class({
    Name: 'DeviceDatabase',
    Extends: events.EventEmitter,

    _init: function() {
        events.EventEmitter.call(this);

        // FIXME: use Map when node supports it
        this._devices = {};
        this._factory = null;
    },

    setFactory: function(factory) {
        this._factory = factory;
    },

    _loadOneDevice: function(serializedDevice) {
        return Q.try(function() {
            return this._factory.createDevice(serializedDevice.kind, serializedDevice);
        }.bind(this)).then(function(device) {
            this._addDeviceInternal(device, serializedDevice);
        }.bind(this)).catch(function(e) {
            console.error('Failed to load one device: ' + e);
        });
    },

    load: function() {
        // load the device db from... somewhere
        throw new Error('Not implemented');
    },

    save: function() {
        // save the device db... somewhere
        throw new Error('Not implemented');
    },

    getAllDevices: function() {
        var devices = [];
        for (var id in this._devices)
            devices.push(this._devices[id]);
        return devices;
    },

    getAllDevicesOfKind: function(kind) {
        return this.getAllDevices().filter(function(device) {
            return device.hasKind(kind);
        });
    },

    _addDeviceInternal: function(device, serializedDevice) {
        if (device.uniqueId === undefined) {
            if (serializedDevice === undefined)
                device.uniqueId = 'uuid-' + uuid.v4();
            else
                device.uniqueId = serializedDevice.uniqueId;
        } else {
            if (serializedDevice.uniqueId !== undefined &&
                device.uniqueId !== serializedDevice.uniqueId)
                throw new Error('Device unique id is different from stored value');
        }

        this._devices[device.uniqueId] = device;
        this.emit('device-added', device);
    },

    addDevice: function(device) {
        this._addDeviceInternal(device);
    },

    getDevice: function(uniqueId) {
        if (uniqueId in this._devices)
            return this._devices[uniqueId];
        else
            throw new Error('Unknown device ' + uniqueId);
    }
});

const FileDeviceDatabase = new lang.Class({
    Name: 'FileDeviceDatabase',
    Extends: DeviceDatabase,

    _init: function(file) {
        this.parent();
        this._file = file;
    },

    load: function() {
        return Q.nfcall(fs.readFile, this._file)
            .then(function(data) {
                return Q.all(JSON.parse(data).map(function(serializedDevice) {
                    return this._loadOneDevice(serializedDevice);
                }.bind(this)));
            }.bind(this))
            .catch(function(e) {
                if (e.code != 'ENOENT')
                    throw e;
            });
    },

    save: function() {
        var data = JSON.stringify(this.getAllDevices().map(function(d) { return d.serialize(); }));
        return Q.nfcall(fs.writeFile, this._file, data);
    },
});

module.exports = {
    AppDatabase: AppDatabase,
    FileAppDatabase: FileAppDatabase,
    DeviceDatabase: DeviceDatabase,
    FileDeviceDatabase: FileDeviceDatabase,
};
