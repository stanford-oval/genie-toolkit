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

const SyncDatabase = require('./syncdb');

module.exports = new lang.Class({
    Name: 'DeviceDatabase',
    Extends: events.EventEmitter,

    _init: function(sqldb, tierManager, deviceFactory) {
        events.EventEmitter.call(this);

        // FIXME: use Map when node supports it
        this._devices = {};
        this._factory = deviceFactory;

        this._sqldb = sqldb;
        this._syncdb = new SyncDatabase(sqldb, tierManager);
    },

    setFactory: function(factory) {
        this._factory = factory;
    },

    _loadOneDevice: function(serializedDevice, addToDB) {
        return Q.try(function() {
            return this._factory.createDevice(serializedDevice.kind, serializedDevice);
        }.bind(this)).then(function(device) {
            return this._addDeviceInternal(device, serializedDevice, addToDB);
        }.bind(this)).catch(function(e) {
            console.error('Failed to load one device: ' + e);
        });
    },

    load: function() {
        this._objectAddedHandler = this._onObjectAdded.bind(this);
        this._objectDeletedHandler = this._onObjectDeleted.bind(this);

        this._syncdb.on('object-added', this._objectAddedHandler);
        this._syncdb.on('object-deleted', this._objectDeletedHandler);
        this._syncdb.open();
        return this._sqldb.getAll(function(serializedDevices) {
            return Q.all(serializedDevices.map(this._loadOneDevice.bind(this)));
        }.bind(this));
    },

    _onObjectAdded: function(serializedDevice) {
        if (serializedDevice.uniqueId in this._devices)
            this._devices[serializedDevice.uniqueId].updateState(serializedDevice);
        else
            this._loadOneDevice(serializedDevice).done();
    },

    _onObjectDeleted: function(uniqueId) {
        delete this._devices[uniqueId];
    },

    save: function() {
        // database is always saved, nothing to do here
        this._syncdb.close();
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

    _addDeviceInternal: function(device, serializedDevice, addToDB) {
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
        if (addToDB) {
            var state = device.serialize();
            if (state.uniqueId === undefined)
                state.uniqueId = device.uniqueId;
            return this._syncdb.insertOne(state).then(function() {
                this.emit('device-added', device);
            }.bind(this));
        } else {
            this.emit('device-added', device);
        }
    },

    addDevice: function(device) {
        return this._addDeviceInternal(device);
    },

    removeDevice: function(device) {
        delete this._devices[device.uniqueId];
        return this._syncdb.deleteOne(device.uniqueId);
    },

    getDevice: function(uniqueId) {
        if (uniqueId in this._devices)
            return this._devices[uniqueId];
        else
            throw new Error('Unknown device ' + uniqueId);
    }
});
