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
const uuid = require('node-uuid');

const SyncDatabase = require('../util/syncdb');
const ObjectSet = require('../util/object_set');
const TierManager = require('../tier_manager').Tier;

// An implementation of ObjectSet for all devices known to (this) system
class AllDeviceSet extends ObjectSet.Base {
    constructor(db) {
        super();
        this._db = db;
    }

    maybeAddObject(o) {
        this.objectAdded(o);
    }

    maybeRemoveObject(o) {
        this.objectRemoved(o);
    }

    values() {
        return this._db.getAllDevices();
    }
}


module.exports = class DeviceDatabase extends events.EventEmitter {
     constructor(platform, tierManager, deviceFactory, schemas) {
        super();
        this.setMaxListeners(0);

        this.factory = deviceFactory;
        this.schemas = schemas;

        // FIXME: use Map when node supports it
        this._devices = {};
        this._byDescriptor = {};

        this._syncdb = new SyncDatabase(platform, 'device', ['state'], tierManager);

        this._contexts = {};
    }

    getContext(key) {
        if (key in this._contexts)
            return this._contexts[key];

        switch(key) {
        case 'me':
            this._contexts[key] = new AllDeviceSet(this);
            break;
        default:
            throw new Error('Invalid context ' + key);
        }

        return this._contexts[key];
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
        var device = this._devices[uniqueId];
        delete this._devices[uniqueId];
        if (device !== undefined)
            this.emit('device-removed', device);
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

    getAllDevices() {
        var devices = [];
        for (var id in this._devices)
            devices.push(this._devices[id]);
        return devices;
    }

    getAllDevicesOfKind(kind) {
        return this.getAllDevices().filter(function(device) {
            return device.hasKind(kind);
        });
    }

    hasDevicesOfKind(kind) {
        return this.getAllDevicesOfKind(kind).length > 0;
    }

    getDeviceByDescriptor(descriptor) {
        return this._byDescriptor[descriptor];
    }

    _notifyDeviceAdded(device) {
        console.log('Added device ' + device.uniqueId);

        this.emit('device-added', device);

        for (var key in this._contexts)
            this._contexts[key].maybeAddObject(device);
    }

    _notifyDeviceRemoved(device) {
        this.emit('device-removed', device);

        for (var key in this._contexts)
            this._contexts[key].maybeRemoveObject(device);
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

        if (device.uniqueId in this._devices) {
            this._devices[device.uniqueId].updateState(device.serialize());
            return;
        }

        device.on('state-changed', function() {
            this._onDeviceStateChanged(device);
        }.bind(this));

        this._devices[device.uniqueId] = device;
        device.descriptors.forEach(function(descriptor) {
            this._byDescriptor[descriptor] = device;
        }, this);
        if (addToDB && !device.isTransient) {
            var state = device.serialize();
            var uniqueId = device.uniqueId;
            return this._syncdb.insertOne(uniqueId,
                                          { state: JSON.stringify(state) })
                .then(function() {
                    this._notifyDeviceAdded(device);
                    return device;
                }.bind(this));
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
        delete this._devices[device.uniqueId];
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
        return (uniqueId in this._devices);
    }

    getDevice(uniqueId) {
        return this._devices[uniqueId];
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
