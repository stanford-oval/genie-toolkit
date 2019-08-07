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

        this._factory = factory;

        this.schemas = schemas;

        this._devices = new Map;
        this._byDescriptor = {};

        this._tierManager = tierManager;
        this._syncdb = new SyncDatabase(platform, 'device', ['state'], tierManager);

        this._subdeviceAddedListener = this._notifySubdeviceAdded.bind(this);
        this._subdeviceRemovedListener = this._notifySubdeviceRemoved.bind(this);
    }

    async loadOneDevice(serializedDevice, addToDB) {
        if (addToDB)
            console.log('loadOneDevice(..., true) is deprecated; from inside a BaseDevice, return the instance directly; from a platform layer, use addDevice');

        const uniqueId = serializedDevice.uniqueId;
        delete serializedDevice.uniqueId;
        try {
            const device = await this._factory.loadSerialized(serializedDevice.kind, serializedDevice);
            return await this._addDeviceInternal(device, uniqueId, addToDB);
        } catch (e) {
            console.error('Failed to load device ' + uniqueId + ': ' + e);
            console.error(e.stack);
            if (addToDB)
                throw e;
            else
                await this._syncdb.deleteOne(uniqueId);
            return null;
        }
    }

    async start() {
        this._objectAddedHandler = this._onObjectAdded.bind(this);
        this._objectDeletedHandler = this._onObjectDeleted.bind(this);

        this._syncdb.on('object-added', this._objectAddedHandler);
        this._syncdb.on('object-deleted', this._objectDeletedHandler);
        this._syncdb.open();
        const rows = await this._syncdb.getAll();

        await Promise.all(rows.map(async (row) => {
            try {
                const serializedDevice = JSON.parse(row.state);
                serializedDevice.uniqueId = row.uniqueId;
                await this.loadOneDevice(serializedDevice, false);
            } catch (e) {
                console.error('Failed to load one device: ' + e);
            }
        }));
    }

    _onObjectAdded(uniqueId, row) {
        const serializedDevice = JSON.parse(row.state);
        if (uniqueId in this._devices) {
            this._devices[uniqueId].updateState(serializedDevice);
        } else {
            serializedDevice.uniqueId = uniqueId;
            this.loadOneDevice(serializedDevice, false);
        }
    }

    _onObjectDeleted(uniqueId) {
        const device = this._devices.get(uniqueId);
        if (device !== undefined) {
            this._removeDeviceFromCache(device);
            this._notifyDeviceRemoved(device);
        }
    }

    async stop() {
        this._syncdb.close();
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
        const devices = [];

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

    _notifySubdeviceAdded(subdevice) {
        // emit only device-added, not object-added
        //
        // object-added is used for cloud synchronization,
        // and refers only to objects in the top-most level
        // of the device tree; it pairs with .values()
        // object-added is also used by DeviceView, which
        // does its subdevice tracking
        //
        // device-added is used by the UI layers for
        // My Goods, and provides a flat view of all devices;
        // it pairs with getAllDevices(), which is also flat
        this.emit('device-added', subdevice);

        // recursively check for subdevices
        const subsubdevices = subdevice.queryInterface('subdevices');
        if (subsubdevices !== null)
            this._startSubdevices(subsubdevices);
    }

    _notifySubdeviceRemoved(subdevice) {
        this.emit('device-removed', subdevice);

        // recursively check for subdevices
        const subsubdevices = subdevice.queryInterface('subdevices');
        if (subsubdevices !== null)
            this._stopSubdevices(subsubdevices);
    }

    _startSubdevices(subdevices) {
        subdevices.on('object-added', this._subdeviceAddedListener);
        subdevices.on('object-removed', this._subdeviceRemovedListener);

        for (const subdevice of subdevices.values())
            this._notifySubdeviceAdded(subdevice);
    }

    _stopSubdevices(subdevices) {
        subdevices.removeListener('object-added', this._subdeviceAddedListener);
        subdevices.removeListener('object-removed', this._subdeviceRemovedListener);

        for (const subdevice of subdevices.values())
            this._notifySubdeviceRemoved(subdevice);
    }

    async _notifyDeviceAdded(device) {
        console.log('Added device ' + device.uniqueId);

        // for compat, emit it first
        this.emit('device-added', device);
        this.objectAdded(device);

        const subdevices = device.queryInterface('subdevices');
        if (subdevices !== null)
            this._startSubdevices(subdevices);

        if (device.ownerTier === this._tierManager.ownTier + this._tierManager.ownIdentity ||
            device.ownerTier === 'global')
            await device.start();
        return device;
    }

    async _notifyDeviceRemoved(device) {
        this.emit('device-removed', device);
        this.objectRemoved(device);

        const subdevices = device.queryInterface('subdevices');
        if (subdevices !== null)
            this._stopSubdevices(subdevices);

        if (device.ownerTier === this._tierManager.ownTier + this._tierManager.ownIdentity ||
            device.ownerTier === 'global') {
            try {
                await device.stop();
            } catch (e) {
                console.error('Device failed to stop: ' + e.message);
                console.error(e.stack);
            }
        }
    }

    async _saveDevice(device) {
        if (device.isTransient)
            return;
        var state = device.serialize();
        var uniqueId = device.uniqueId;
        await this._syncdb.insertOne(uniqueId, { state: JSON.stringify(state) });
    }

    async _addDeviceInternal(device, uniqueId, addToDB) {
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
            const existing = this._devices.get(device.uniqueId);
            await existing.updateState(device.serialize());
            return existing;
        }

        device.on('state-changed', () => {
            this._saveDevice(device);
        });

        this._devices.set(device.uniqueId, device);
        device.descriptors.forEach(function(descriptor) {
            this._byDescriptor[descriptor] = device;
        }, this);
        if (addToDB)
            await this._saveDevice(device);

        return this._notifyDeviceAdded(device);
    }

    async addDevice(device) {
        // Check if the device was already added, if so, do nothing
        // This is compatibility code to handle both the old and the new way to configure devices:
        // the old way required each device to add themselves to the database,
        // in the new way the device just configures itself and expects the calling
        // code to save it
        if (device.uniqueId !== undefined && this._devices.get(device.uniqueId) === device)
            return;

        await this._addDeviceInternal(device, undefined, true);
    }

    async addSerialized(state) {
        const instance = await this._factory.loadSerialized(state.kind, state);
        await this.addDevice(instance);
        return instance;
    }
    addFromOAuth(kind) {
        return this._factory.loadFromOAuth(kind);
    }
    async completeOAuth(kind, url, session) {
        const instance = await this._factory.completeOAuth(kind, url, session);
        await this.addDevice(instance);
        return instance;
    }
    addFromDiscovery(kind, publicData, privateData) {
        return this._factory.loadFromDiscovery(kind, publicData, privateData);
    }
    async completeDiscovery(instance, delegate) {
        await instance.completeDiscovery(delegate);
        await this.addDevice(instance);
        return instance;
    }
    async addInteractively(kind, delegate) {
        const instance = await this._factory.loadInteractively(kind, delegate);
        await this.addDevice(instance);
        return instance;
    }

    _removeDeviceFromCache(device) {
        this._devices.delete(device.uniqueId);
        device.descriptors.forEach((descriptor) => {
            delete this._byDescriptor[descriptor];
        });
    }

    async removeDevice(device) {
        this._removeDeviceFromCache(device);
        if (!device.isTransient)
            await this._syncdb.deleteOne(device.uniqueId);

        return this._notifyDeviceRemoved(device);
    }

    hasDevice(uniqueId) {
        return this._devices.has(uniqueId);
    }

    getDevice(uniqueId) {
        return this._devices.get(uniqueId);
    }

    async reloadDevice(device) {
        const state = device.serialize();

        await this._removeDeviceFromCache(device);
        await this._notifyDeviceRemoved(device);

        await this.loadOneDevice(state, false);
    }

    getCachedDeviceClasses() {
        return this._factory.getCachedDeviceClasses();
    }

    async updateDevicesOfKind(kind) {
        this.schemas.removeFromCache(kind);

        await this._factory.updateDeviceClass(kind);
        const devices = this._getValuesOfExactKind(kind);

        return Promise.all(devices.map((d) => {
            return this.reloadDevice(d);
        }));
    }
};
module.exports.prototype.$rpcMethods = ['loadOneDevice', 'getAllDevices', 'getAllDevicesOfKind',
                                        'hasDevice', 'getDevice',
                                        'removeDevice',
                                        'addSerialized', 'addFromOAuth', 'completeOAuth',
                                        'addFromDiscovery', 'completeDiscovery', 'addInteractively',
                                        'reloadDevice',
                                        'getCachedDeviceClasses',
                                        'updateDevicesOfKind'];
