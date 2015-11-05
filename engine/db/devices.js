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
const ObjectSet = require('../object_set');
const TierManager = require('../tier_manager').Tier;

// An implementation of ObjectSet for global (built-in, always available)
// devices, such as #timer - well mostly just #timer really, and maybe a few
// others like #google or other stuff that requires no authentication
const GlobalDeviceSet = new lang.Class({
    Name: 'GlobalDeviceSet',
    Extends: ObjectSet.Simple,

    _init: function(factory) {
        this.parent(false);

        this._factory = factory;
    },

    open: function() {
        // FINISHME: de-hardcode this
        this.addOne(this._factory.createDevice('timer', { kind: 'timer' }));
        this.freeze();
        return this.promise();
    },

    close: function() {
        return Q();
    },
});


// An implementation of ObjectSet for all devices known to (this) system, which is
// @me
const AllDeviceSet = new lang.Class({
    Name: 'AllDeviceSet',
    Extends: ObjectSet.Base,

    _init: function(db) {
        this._db = db;
    },

    maybeAddObject: function(o) {
        this.objectAdded(o);
    },

    maybeRemoveObject: function(o) {
        this.objectRemoved(o);
    },

    promise: function() {
        // devicedb is always loaded before everything else, so this is always ready
        return Q();
    },

    keys: function() {
        return this._db.values().map(function(d) { return d.uniqueId; });
    },

    values: function() {
        return this._db.getAllDevices();
    },
});


// An implementation of ObjectSet for devices that are available in a specific tier
// tier - reflects the content of DeviceDatabase, filtered by tier
const SpecificTierDeviceSet = new lang.Class({
    Name: 'CurrentTierDeviceSet',
    Extends: ObjectSet.Base,

    _init: function(tier, db) {
        this._tier = tier;
        this._db = db;
    },

    maybeAddObject: function(o) {
        if (o.ownerTier === this._tier)
            this.objectAdded(o);
    },

    maybeRemoveObject: function(o) {
        if (o.ownerTier === this._tier)
            this.objectAdded(o);
    },

    promise: function() {
        // devicedb is always loaded before everything else, so this is always ready
        return Q();
    },

    keys: function() {
        return this._db.values().map(function(d) { return d.uniqueId; });
    },

    values: function() {
        return this._db.getAllDevices().filter(function(d) {
            return d.ownerTier === this._tier;
        }, this);
    },
});


module.exports = new lang.Class({
    Name: 'DeviceDatabase',
    Extends: events.EventEmitter,
    $rpcMethods: ['loadOneDevice', 'getAllDevices', 'getAllDevicesOfKind',
                  'hasDevice', 'getDevice', 'get factory'],

    _init: function(tierManager, deviceFactory) {
        events.EventEmitter.call(this);
        this.setMaxListeners(0);

        this.factory = deviceFactory;

        // FIXME: use Map when node supports it
        this._devices = {};

        this._syncdb = new SyncDatabase('device', ['state'], tierManager);

        this._contexts = {};
        this._global = new GlobalDeviceSet(deviceFactory);
    },

    getContext: function(key) {
        if (key === 'global')
            return this._global;

        if (key in this._contexts)
            return this._contexts[key];

        switch(key) {
        case 'me':
            this._contexts[key] = new AllDeviceSet(this);
            break;
        case 'home':
            this._contexts[key] = new SpecificTierDeviceSet(Tier.SERVER, this);
            break;
        case 'phone':
            this._contexts[key] = new SpecificTierDeviceSet(Tier.PHONE, this);
            break;
        case 'cloud':
            this._contexts[key] = new SpecificTierDeviceSet(Tier.CLOUD, this);
            break;
        default:
            throw new Error('Invalid context ' + key);
        }

        return this._contexts[key];
    },

    loadOneDevice: function(serializedDevice, addToDB) {
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
        }.bind(this)).then(function() {
            return this._global.open();
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

    _onDeviceStateChanged: function(device) {
        var state = device.serialize();
        var uniqueId = device.uniqueId;
        this._syncdb.insertOne(uniqueId,
                               { state: JSON.stringify(state) }).done();
    },

    stop: function() {
        this._syncdb.close();
        return this._global.close();
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

    _notifyDeviceAdded: function(device) {
        console.log('Added device ' + device.uniqueId);

        this.emit('device-added', device);

        for (var key in this._contexts)
            this._contexts[key].maybeAddObject(device);
    },

    _notifyDeviceRemoved: function(device) {
        this.emit('device-removed', device);

        for (var key in this._contexts)
            this._contexts[key].maybeRemoveObject(device);
    },

    _addDeviceInternal: function(device, uniqueId, addToDB) {
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

        device.on('state-changed', function() {
            this._onDeviceStateChanged(device);
        }.bind(this));

        this._devices[device.uniqueId] = device;
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
    },

    addDevice: function(device) {
        return this._addDeviceInternal(device, undefined, true);
    },

    removeDevice: function(device) {
        delete this._devices[device.uniqueId];
        if (device.isTransient) {
            this._notifyDeviceRemoved(device);
        } else {
            return this._syncdb.deleteOne(device.uniqueId).then(function() {
                this._notifyDeviceRemoved(device);
            }.bind(this));
        }
    },

    hasDevice: function(uniqueId) {
        return (uniqueId in this._devices);
    },

    getDevice: function(uniqueId) {
        if (uniqueId in this._devices)
            return this._devices[uniqueId];
        else
            throw new Error('Unknown device ' + uniqueId);
    }
});
