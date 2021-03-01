// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>


import * as uuid from 'uuid';

import * as Tp from 'thingpedia';
const ObjectSet = Tp.ObjectSet;
import SyncDatabase from '../db/syncdb';

// check for updates of all devices every 3 hours
// this is to catch bug fixes quickly
// we'll lower this to 24 hours after the alpha release
const UPDATE_FREQUENCY = 3 * 3600 * 1000;

/**
 * The collection of all configured Thingpedia devices.
 */
export default class DeviceDatabase extends ObjectSet.Base {
    /**
     * Construct the device database for this engine.
     *
     * There is only one device database instance per engine,
     * and it is accessible as {@link Engine#devices}.
     *
     * @param {external:thingpedia.BasePlatform} - the platform associated with the engine
     * @param {TierManager} - the tier manager to use for device synchronization
     * @param {external:thingpedia.DeviceFactory} - the factory to load and construct Thingpedia devices
     * @param {external:thingtalk.SchemaRetriever} - the schema retriever to typecheck ThingTalk code
     * @package
     */
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

        this._isUpdatingState = false;

        this._updateTimer = null;
    }

    async loadOneDevice(serializedDevice, addToDB) {
        if (addToDB)
            console.log('loadOneDevice(..., true) is deprecated; from inside a BaseDevice, return the instance directly; from a platform layer, use addDevice');

        const uniqueId = serializedDevice.uniqueId;
        delete serializedDevice.uniqueId;
        try {
            const device = await this._factory.loadSerialized(serializedDevice.kind, serializedDevice);
            return await this._addDeviceInternal(device, uniqueId, addToDB);
        } catch(e) {
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
            } catch(e) {
                console.error('Failed to load one device: ' + e);
            }
        }));

        this._updateTimer = setInterval(() => this._updateAll(), UPDATE_FREQUENCY);
    }

    _onObjectAdded(uniqueId, row) {
        const serializedDevice = JSON.parse(row.state);
        if (uniqueId in this._devices) {
            this._isUpdatingState = true;
            this._devices[uniqueId].updateState(serializedDevice);
            this._isUpdatingState = false;
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
        if (this._updateTimer)
            clearInterval(this._updateTimer);
        this._updateTimer = null;
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
            for (let d of ctx.values()) {
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
            } catch(e) {
                console.error('Device failed to stop: ' + e.message);
                console.error(e.stack);
            }
        }
    }

    async _saveDevice(device) {
        if (device.isTransient)
            return;
        let state = device.serialize();
        let uniqueId = device.uniqueId;
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

            this._isUpdatingState = true;
            existing.updateState(device.serialize());
            this._isUpdatingState = false;
            await this._saveDevice(device);
            return existing;
        }

        device.on('state-changed', () => {
            if (this._isUpdatingState)
                return;

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
        await this._reloadAllDevices(kind);
    }

    async _reloadAllDevices(kind) {
        const devices = this._getValuesOfExactKind(kind);

        return Promise.all(devices.map((d) => {
            return this.reloadDevice(d);
        }));
    }

    async _updateAll() {
        const kinds = new Map; // from kind to version

        for (const dev of this._devices.values())
            kinds.set(dev.kind, dev.constructor.metadata.version);

        for (const [kind, oldVersion] of kinds) {
            if (kind.startsWith('org.thingpedia.builtin'))
                continue;

            this.schemas.removeFromCache(kind);
            await this._factory.updateDeviceClass(kind);
            const newClass = await this._factory.getDeviceClass(kind);
            if (newClass.metadata.version !== oldVersion)
                await this._reloadAllDevices(kind);
        }
    }
}
