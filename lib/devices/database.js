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

const Tp = require('thingpedia');
const ObjectSet = Tp.ObjectSet;
const SyncDatabase = require('../db/syncdb');

module.exports = class DeviceDatabase extends ObjectSet.Base {
     constructor(platform, tierManager, factory, schemas) {
        super();
        this.setMaxListeners(0);

        this.factory = factory;

        // for compat only
        this.schemas = schemas;

        this._devices = new Map();
        this._byDescriptor = {};

        this._tierManager = tierManager;
        this._syncdb = new SyncDatabase(platform, 'device', ['state'], tierManager);
    }

    loadOneDevice(serializedDevice, addToDB) {
        var uniqueId = serializedDevice.uniqueId;
        delete serializedDevice.uniqueId;
        return Q.try(function() {
            return this.factory.createDevice(serializedDevice.kind, serializedDevice);
        }.bind(this)).tap(function(device) {
            return this._addDeviceInternal(device, uniqueId, addToDB);
        }.bind(this)).catch(function(e) {
            console.error('Failed to load device ' + uniqueId + ': ' + e);
            console.error(e.stack);
            throw e;
        });
    }

    start() {
        this._objectAddedHandler = this._onObjectAdded.bind(this);
        this._objectDeletedHandler = this._onObjectDeleted.bind(this);

        this._syncdb.on('object-added', this._objectAddedHandler);
        this._syncdb.on('object-deleted', this._objectDeletedHandler);
        this._syncdb.open();
        return this._syncdb.getAll().then((rows) => {
            return Q.all(rows.map((row) => {
                return Q.try(() => {
                    var serializedDevice = JSON.parse(row.state);
                    serializedDevice.uniqueId = row.uniqueId;
                    return this.loadOneDevice(serializedDevice, false);
                }).catch((e) => {
                    console.log('Failed to load one device: ' + e);
                });
            }));
        });
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

    stop() {
        this._syncdb.close();
        return Q();
    }

    // return all devices directly stored in the database
    values() {
        return Array.from(this._devices.values());
    }

    _getValuesOfExactKind(kind) {
        return this.values().filter((d) => d.kind === kind);
    }

    // return all devices, and resolve meta devices into concrete devices
    // the result of this call might change without an object-added/object-removed
    // event
    // use DeviceView to track all the devices that match a selector
    //
    // if kind is not undefined, only devices with hasKind(kind) will be returned
    getAllDevices(kind) {
        var devices = [];

        function addContext(ctx) {
            for (var d of ctx.values()) {
                if (kind === undefined || d.hasKind(kind))
                    devices.push(d);
                var subview = d.queryInterface('subdevices');
                if (subview !== null)
                    addContext(subview);
            }
        }
        addContext(this);
        return devices;
    }

    getAllDevicesOfKind(kind) {
        return this.getAllDevices(kind);
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

        var start;
        if (device.ownerTier === this._tierManager.ownTier ||
            device.ownerTier === 'global')
            start = Q(device.start());
        else
            start = Q();
        return start.then(function() { return device; });
    }

    _notifyDeviceRemoved(device) {
        this.emit('device-removed', device);
        this.objectRemoved(device);

        var stop;
        if (device.ownerTier === this._tierManager.ownTier ||
            device.ownerTier === 'global')
            stop = Q(device.stop());
        else
            stop = Q();
        stop.catch(function(e) {
            console.error('Device failed to stop: ' + e.message);
            console.error(e.stack);
        }).done();
    }

    _saveDevice(device) {
        if (device.isTransient)
            return Q();
        var state = device.serialize();
        var uniqueId = device.uniqueId;
        return this._syncdb.insertOne(uniqueId,
                                      { state: JSON.stringify(state) });
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
                throw new Error('Device unique id is different from stored value (old ' + uniqueId + ', new ' + device.uniqueId + ')');
        }

        if (this._devices.has(device.uniqueId)) {
            this._devices.get(device.uniqueId).updateState(device.serialize());
            return;
        }

        device.on('state-changed', () => {
            this._saveDevice(device).done();
        });

        this._devices.set(device.uniqueId, device);
        device.descriptors.forEach(function(descriptor) {
            this._byDescriptor[descriptor] = device;
        }, this);
        if (addToDB) {
            return this._saveDevice(device).then(() => {
                return this._notifyDeviceAdded(device);
            });
        } else {
            return this._notifyDeviceAdded(device);
        }
    }

    addDevice(device) {
        return this._addDeviceInternal(device, undefined, true);
    }

    saveDevice(device) {
        device.isTransient = false;
        return this._saveDevice(device);
    }

    loadFromDiscovery(kind, publicData, privateData) {
        return this.factory.loadFromDiscovery(kind, publicData, privateData);
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
            var devices = this._getValuesOfExactKind(kind);

            return Q.all(devices.map(function(d) {
                return this.reloadDevice(d);
            }, this));
        }.bind(this));
    }
}
module.exports.prototype.$rpcMethods = ['loadOneDevice', 'getAllDevices', 'getAllDevicesOfKind',
                                        'hasDevice',
                                        'getDevice', 'removeDevice', 'get factory', 'get schemas',
                                        'reloadDevice', 'updateDevicesOfKind'];
