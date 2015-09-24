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
    $rpcMethods: ['loadOneDevice', 'getAllDevices', 'getAllDevicesOfKind',
                  'hasDevice', 'getDevice'],

    _init: function(tierManager, deviceFactory) {
        events.EventEmitter.call(this);

        // FIXME: use Map when node supports it
        this._devices = {};
        this._factory = deviceFactory;

        this._syncdb = new SyncDatabase('device', ['state'], tierManager);
    },

    loadOneDevice: function(serializedDevice, addToDB) {
        return Q.try(function() {
            return this._factory.createDevice(serializedDevice.kind, serializedDevice);
        }.bind(this)).then(function(device) {
            return this._addDeviceInternal(device, serializedDevice, addToDB);
        }.bind(this)).catch(function(e) {
            console.error('Failed to load one device: ' + e);
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
                    var serializedDevice = JSON.parse(row.state);
                    serializedDevice.uniqueId = row.uniqueId;
                    return this.loadOneDevice(serializedDevice, false);
                } catch(e) {
                    console.log('Failed to load one device: ' + e);
                }
            }.bind(this)));
        }.bind(this));
    },

    _onObjectAdded: function(uniqueId, row) {
        var serializedDevice = JSON.parse(row.state);
        if (uniqueId in this._devices) {
            this._devices[uniqueId].updateState(serializedDevice);
        } else {
            serializedDevice.uniqueId = uniqueId;
            this.loadOneDevice(serializedDevice, false).done();
        }
    },

    _onObjectDeleted: function(uniqueId) {
        var device = this._devices[uniqueId];
        delete this._devices[uniqueId];
        if (device !== undefined)
            this.emit('device-removed', device);
    },

    stop: function() {
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
            var uniqueId = device.uniqueId;
            return this._syncdb.insertOne(uniqueId,
                                          { state: JSON.stringify(state) })
                .then(function() {
                    this.emit('device-added', device);
                }.bind(this));
        } else {
            this.emit('device-added', device);
            return Q();
        }
    },

    addDevice: function(device) {
        return this._addDeviceInternal(device, undefined, true);
    },

    removeDevice: function(device) {
        delete this._devices[device.uniqueId];
        return this._syncdb.deleteOne(device.uniqueId).then(function() {
            this.emit('device-removed', device);
        }.bind(this));
    },

    hasDevice: function(uniqueId) {
        return uniqueId in this._devices;
    },

    getDevice: function(uniqueId) {
        if (uniqueId in this._devices)
            return this._devices[uniqueId];
        else
            throw new Error('Unknown device ' + uniqueId);
    }
});
