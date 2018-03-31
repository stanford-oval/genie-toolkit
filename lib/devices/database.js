// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const uuid = require('uuid');

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
        return Promise.resolve().then(() => {
            return this.factory.createDevice(serializedDevice.kind, serializedDevice);
        }).tap((device) => {
            return this._addDeviceInternal(device, uniqueId, addToDB);
        }).catch((e) => {
            console.error('Failed to load device ' + uniqueId + ': ' + e);
            if (addToDB)
                throw e;
            else
                return this._syncdb.deleteOne(uniqueId);
        });
    }

    start() {
        this._objectAddedHandler = this._onObjectAdded.bind(this);
        this._objectDeletedHandler = this._onObjectDeleted.bind(this);

        this._syncdb.on('object-added', this._objectAddedHandler);
        this._syncdb.on('object-deleted', this._objectDeletedHandler);
        this._syncdb.open();
        return this._syncdb.getAll().then((rows) => {
            return Promise.all(rows.map((row) => {
                return Promise.resolve().then(() => {
                    var serializedDevice = JSON.parse(row.state);
                    serializedDevice.uniqueId = row.uniqueId;
                    return this.loadOneDevice(serializedDevice, false);
                }).catch((e) => {
                    console.error('Failed to load one device: ' + e);
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
        return Promise.resolve();
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
                try {
                    const subview = d.queryInterface('subdevices');
                    if (subview !== null)
                        addContext(subview);
                } catch(e) {
                    console.error('Failed to query device ' + d.uniqueId + ' for subdevices', e);
                }
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

    _notifyDeviceAdded(device) {
        console.log('Added device ' + device.uniqueId);

        // for compat, emit it first
        this.emit('device-added', device);
        this.objectAdded(device);

        var start;
        if (device.ownerTier === this._tierManager.ownTier ||
            device.ownerTier === 'global')
            start = Promise.resolve(device.start());
        else
            start = Promise.resolve();
        return start.then(() => device);
    }

    _notifyDeviceRemoved(device) {
        this.emit('device-removed', device);
        this.objectRemoved(device);

        var stop;
        if (device.ownerTier === this._tierManager.ownTier ||
            device.ownerTier === 'global')
            stop = Promise.resolve(device.stop());
        else
            stop = Promise.resolve();
        stop.catch((e) => {
            console.error('Device failed to stop: ' + e.message);
            console.error(e.stack);
        });
    }

    _saveDevice(device) {
        if (device.isTransient)
            return Promise.resolve();
        var state = device.serialize();
        var uniqueId = device.uniqueId;
        return this._syncdb.insertOne(uniqueId, { state: JSON.stringify(state) });
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
            return Promise.resolve();
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
            return Promise.resolve();
        } else {
            return this._syncdb.deleteOne(device.uniqueId).then(() => {
                this._notifyDeviceRemoved(device);
            });
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

        return Promise.resolve().then(() => {
            return this.loadOneDevice(state, false);
        });
    }

    updateDevicesOfKind(kind) {
        return this.factory.updateFactory(kind).then(() => {
            var devices = this._getValuesOfExactKind(kind);

            return Promise.all(devices.map((d) => {
                return this.reloadDevice(d);
            }));
        });
    }
};
module.exports.prototype.$rpcMethods = ['loadOneDevice', 'getAllDevices', 'getAllDevicesOfKind',
                                        'hasDevice',
                                        'getDevice', 'removeDevice', 'get factory', 'get schemas',
                                        'reloadDevice', 'updateDevicesOfKind'];
