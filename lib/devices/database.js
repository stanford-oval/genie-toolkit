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
const fs = require('fs');
const uuid = require('node-uuid');

const SyncDatabase = require('../util/syncdb');
const ObjectSet = require('../util/object_set');

module.exports = class DeviceDatabase extends ObjectSet.Base {
     constructor(platform, tierManager, factory, schemas) {
        super();
        this.setMaxListeners(0);

        this.factory = factory;

        // for compat only
        this.schemas = schemas;

        this._devices = new Map();
        this._byDescriptor = {};

        this._syncdb = new SyncDatabase(platform, 'device', ['state'], tierManager);
    }

    loadOneDevice(serializedDevice, addToDB) {
        var uniqueId = serializedDevice.uniqueId;
        delete serializedDevice.uniqueId;
        return Q.try(function() {
            return this.factory.createDevice(serializedDevice.kind, serializedDevice);
        }.bind(this)).then(function(device) {
            return this._addDeviceInternal(device, uniqueId, addToDB);
        }.bind(this)).catch(function(e) {
            console.error('Failed to load one device: ' + e);
            console.error(e.stack);
        });
    }

    start() {
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
    }

    _onObjectAdded(uniqueId, row) {
        var serializedDevice = JSON.parse(row.state);
        if (uniqueId in this._devices) {
            this._devices[uniqueId].updateState(serializedDevice);
        } else {
            serializedDevice.uniqueId = uniqueId;
            this.loadOneDevice(serializedDevice, false).done();
        }
    }

    _onObjectDeleted(uniqueId) {
        var device = this._devices.get(uniqueId);
        if (device !== undefined) {
            this._removeDeviceFromCache(device);
            this._notifyDeviceRemoved(device);
        }
    }

    _onDeviceStateChanged(device) {
        var state = device.serialize();
        var uniqueId = device.uniqueId;
        this._syncdb.insertOne(uniqueId,
                               { state: JSON.stringify(state) }).done();
    }

    stop() {
        this._syncdb.close();
        return Q();
    }

    values() {
        return Array.from(this._devices.values());
    }

    // for compat
    getAllDevices() {
        return this.values();
    }

    getAllDevicesOfKind(kind) {
        return this.values().filter(function(device) {
            return device.hasKind(kind);
        });
    }

    hasDevicesOfKind(kind) {
        return this.getAllDevicesOfKind(kind).length > 0;
    }

    getDeviceByDescriptor(descriptor) {
        return this._byDescriptor[descriptor];
    }

    getDevicesByGlobalName(name) {
        return this.values().filter(function(device) {
            return device.globalName === name;
        });
    }

    _notifyDeviceAdded(device) {
        console.log('Added device ' + device.uniqueId);

        // for compat, emit it first
        this.emit('device-added', device);
        this.objectAdded(device);
    }

    _notifyDeviceRemoved(device) {
        this.emit('device-removed', device);
        this.objectRemoved(device);
    }

    _addDeviceInternal(device, uniqueId, addToDB) {
        if (device.uniqueId === undefined) {
            if (uniqueId === undefined)
                device.uniqueId = device.kind + '-' + uuid.v4();
            else
                device.uniqueId = uniqueId;
        } else {
            if (uniqueId !== undefined &&
                device.uniqueId !== uniqueId)
                throw new Error('Device unique id is different from stored value');
        }

        if (this._devices.has(device.uniqueId)) {
            this._devices.get(device.uniqueId).updateState(device.serialize());
            return;
        }

        device.on('state-changed', () => {
            this._onDeviceStateChanged(device);
        });

        this._devices.set(device.uniqueId, device);
        device.descriptors.forEach(function(descriptor) {
            this._byDescriptor[descriptor] = device;
        }, this);
        if (addToDB && !device.isTransient) {
            var state = device.serialize();
            var uniqueId = device.uniqueId;
            return this._syncdb.insertOne(uniqueId,
                                          { state: JSON.stringify(state) })
                .then(() => {
                    this._notifyDeviceAdded(device);
                    return device;
                });
        } else {
            this._notifyDeviceAdded(device);
            return Q(device);
        }
    }

    addDevice(device) {
        return this._addDeviceInternal(device, undefined, true);
    }

    addFromDiscovery(kind, publicData, privateData) {
        return this.factory.addFromDiscovery(kind, publicData, privateData);
    }

    _removeDeviceFromCache(device) {
        this._devices.delete(device.uniqueId);
        device.descriptors.forEach(function(descriptor) {
            delete this._byDescriptor[descriptor];
        }, this);
    }

    removeDevice(device) {
        this._removeDeviceFromCache(device);
        if (device.isTransient) {
            this._notifyDeviceRemoved(device);
        } else {
            return this._syncdb.deleteOne(device.uniqueId).then(function() {
                this._notifyDeviceRemoved(device);
            }.bind(this));
        }
    }

    hasDevice(uniqueId) {
        return this._devices.has(uniqueId);
    }

    getDevice(uniqueId) {
        return this._devices.get(uniqueId);
    }

    reloadDevice(device) {
        var state = device.serialize();

        this._removeDeviceFromCache(device);
        this._notifyDeviceRemoved(device);

        return Q.delay(0).then(function() {
            return this.loadOneDevice(state, false);
        }.bind(this));
    }

    updateDevicesOfKind(kind) {
        return this.factory.updateFactory(kind).then(function() {
            var devices = this.getAllDevicesOfKind(kind);

            return Q.all(devices.map(function(d) {
                return this.reloadDevice(d);
            }, this));
        }.bind(this));
    }
}
module.exports.prototype.$rpcMethods = ['loadOneDevice', 'getAllDevices', 'getAllDevicesOfKind',
                                        'hasDevice', 'hasDevicesOfKind',
                                        'getDevice', 'removeDevice', 'get factory', 'get schemas',
                                        'reloadDevice', 'updateDevicesOfKind'];
