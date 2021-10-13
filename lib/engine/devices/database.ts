// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
import { ObjectSet } from 'thingpedia';
import { SchemaRetriever } from 'thingtalk';

import { AbstractDatabase } from '../db';
import SyncDatabase from '../db/syncdb';
import SyncManager from '../sync/manager';

// check for updates of all devices every 3 hours
// this is to catch bug fixes quickly
// we'll lower this to 24 hours after the alpha release
const UPDATE_FREQUENCY = 3 * 3600 * 1000;

/**
 * The collection of all configured Thingpedia devices.
 */
export default class DeviceDatabase extends ObjectSet.Base<Tp.BaseDevice> {
    private _factory : Tp.DeviceFactory;
    private schemas : SchemaRetriever;
    private _devices : Map<string, Tp.BaseDevice>;
    private _byDescriptor : Map<string, Tp.BaseDevice>;
    private _syncManager : SyncManager;
    private _syncdb : SyncDatabase<"device">;

    private _subdeviceAddedListener : (device : Tp.BaseDevice) => void;
    private _subdeviceRemovedListener : (device : Tp.BaseDevice) => void;
    private _objectAddedHandler : (uniqueId : string, row : any) => void;
    private _objectDeletedHandler : (uniqueId : string) => void;

    private _isUpdatingState : boolean;
    private _updateTimer : NodeJS.Timeout|null;

    /**
     * Construct the device database for this engine.
     *
     * There is only one device database instance per engine,
     * and it is accessible as {@link AssistantEngine.devices}.
     *
     * @param platform - the platform associated with the engine
     * @param syncManager - the tier manager to use for device synchronization
     * @param factory - the factory to load and construct Thingpedia devices
     * @param schemas - the schema retriever to typecheck ThingTalk code
     * @internal
     */
    constructor(platform : Tp.BasePlatform,
                db : AbstractDatabase,
                syncManager : SyncManager,
                factory : Tp.DeviceFactory,
                schemas : SchemaRetriever) {
        super();
        this.setMaxListeners(0);

        this._factory = factory;

        this.schemas = schemas;

        this._devices = new Map;
        this._byDescriptor = new Map;

        this._syncManager = syncManager;
        this._syncdb = new SyncDatabase(platform, db, 'device', syncManager);

        this._subdeviceAddedListener = this._notifySubdeviceAdded.bind(this);
        this._subdeviceRemovedListener = this._notifySubdeviceRemoved.bind(this);
        this._objectAddedHandler = this._onObjectAdded.bind(this);
        this._objectDeletedHandler = this._onObjectDeleted.bind(this);

        this._isUpdatingState = false;

        this._updateTimer = null;
    }

    async loadOneDevice(serializedDevice : Tp.BaseDevice.DeviceState & { uniqueId ?: string },
                        addToDB : boolean) {
        if (addToDB)
            console.log('loadOneDevice(..., true) is deprecated; from inside a BaseDevice, return the instance directly; from a platform layer, use addDevice');

        const uniqueId = serializedDevice.uniqueId!;
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
        this._syncdb.on('object-added', this._objectAddedHandler);
        this._syncdb.on('object-deleted', this._objectDeletedHandler);
        this._syncdb.open();
        const rows = await this._syncdb.getAll();

        await Promise.all(rows.map(async (row : any) => {
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

    private _onObjectAdded(uniqueId : string, row : any) {
        const serializedDevice = JSON.parse(row.state);
        if (this._devices.has(uniqueId)) {
            this._isUpdatingState = true;
            this._devices.get(uniqueId)!.updateState(serializedDevice);
            this._isUpdatingState = false;
        } else {
            serializedDevice.uniqueId = uniqueId;
            this.loadOneDevice(serializedDevice, false);
        }
    }

    private _onObjectDeleted(uniqueId : string) {
        const device = this._devices.get(uniqueId);
        if (device !== undefined) {
            this._removeDeviceFromCache(device);
            this._notifyDeviceRemoved(device);
        }
    }

    async stop() {
        await this._syncdb.close();
        if (this._updateTimer)
            clearInterval(this._updateTimer);
        this._updateTimer = null;

        await Promise.all(this.values().map(async (device) => {
            if (device.ownerTier === this._syncManager.ownTier + this._syncManager.ownIdentity ||
                device.ownerTier === 'global') {
                try {
                    await device.stop();
                } catch(e) {
                    console.error('Device failed to stop: ' + e.message);
                    console.error(e.stack);
                }
            }
        }));
    }

    // return all devices directly stored in the database
    values() {
        return Array.from(this._devices.values());
    }

    private _getValuesOfExactKind(kind : string) {
        return this.values().filter((d) => d.kind === kind);
    }

    /**
     * Return all devices, and expand collection devices into concrete devices.
     *
     * The result of this call might change without an object-added/object-removed
     * event. Use DeviceView to track all the devices that match a selector.
     *
     * @param kind - if specified, only devices with `hasKind(kind)` will be returned.
     * */
    getAllDevices(kind ?: string) {
        const devices : Tp.BaseDevice[] = [];

        function addContext(ctx : Tp.ObjectSet.Base<Tp.BaseDevice>) {
            for (const d of ctx.values()) {
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

    getAllDevicesOfKind(kind ?: string) {
        return this.getAllDevices(kind);
    }

    getDeviceByDescriptor(descriptor : string) {
        return this._byDescriptor.get(descriptor);
    }

    private _notifySubdeviceAdded(subdevice : Tp.BaseDevice) {
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

    private _notifySubdeviceRemoved(subdevice : Tp.BaseDevice) {
        this.emit('device-removed', subdevice);

        // recursively check for subdevices
        const subsubdevices = subdevice.queryInterface('subdevices');
        if (subsubdevices !== null)
            this._stopSubdevices(subsubdevices);
    }

    private _startSubdevices(subdevices : Tp.ObjectSet.Base<Tp.BaseDevice>) {
        subdevices.on('object-added', this._subdeviceAddedListener);
        subdevices.on('object-removed', this._subdeviceRemovedListener);

        for (const subdevice of subdevices.values())
            this._notifySubdeviceAdded(subdevice);
    }

    private _stopSubdevices(subdevices : Tp.ObjectSet.Base<Tp.BaseDevice>) {
        subdevices.removeListener('object-added', this._subdeviceAddedListener);
        subdevices.removeListener('object-removed', this._subdeviceRemovedListener);

        for (const subdevice of subdevices.values())
            this._notifySubdeviceRemoved(subdevice);
    }

    private async _notifyDeviceAdded(device : Tp.BaseDevice) {
        console.log('Added device ' + device.uniqueId);

        // for compat, emit it first
        this.emit('device-added', device);
        this.objectAdded(device);

        const subdevices = device.queryInterface('subdevices');
        if (subdevices !== null)
            this._startSubdevices(subdevices);

        if (device.ownerTier === this._syncManager.ownTier + this._syncManager.ownIdentity ||
            device.ownerTier === 'global')
            await device.start();
        return device;
    }

    private async _notifyDeviceRemoved(device : Tp.BaseDevice) {
        this.emit('device-removed', device);
        this.objectRemoved(device);

        const subdevices = device.queryInterface('subdevices');
        if (subdevices !== null)
            this._stopSubdevices(subdevices);

        if (device.ownerTier === this._syncManager.ownTier + this._syncManager.ownIdentity ||
            device.ownerTier === 'global') {
            try {
                await device.stop();
            } catch(e) {
                console.error('Device failed to stop: ' + e.message);
                console.error(e.stack);
            }
        }
    }

    private async _saveDevice(device : Tp.BaseDevice) {
        this.emit('device-changed', device);
        if (device.isTransient)
            return;
        const state = device.serialize();
        const uniqueId = device.uniqueId!;
        await this._syncdb.insertOne(uniqueId, { state: JSON.stringify(state) });
    }

    private async _addDeviceInternal(device : Tp.BaseDevice, uniqueId : string|undefined, addToDB : boolean) {
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
            const existing = this._devices.get(device.uniqueId)!;

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
        device.descriptors.forEach((descriptor) => {
            this._byDescriptor.set(descriptor, device);
        });
        if (addToDB)
            await this._saveDevice(device);

        return this._notifyDeviceAdded(device);
    }

    async addDevice(device : Tp.BaseDevice) {
        // Check if the device was already added, if so, do nothing
        // This is compatibility code to handle both the old and the new way to configure devices:
        // the old way required each device to add themselves to the database,
        // in the new way the device just configures itself and expects the calling
        // code to save it
        if (device.uniqueId !== undefined && this._devices.get(device.uniqueId) === device)
            return;

        await this._addDeviceInternal(device, undefined, true);
    }

    async addSerialized(state : Tp.BaseDevice.DeviceState) {
        const instance = await this._factory.loadSerialized(state.kind, state);
        await this.addDevice(instance);
        return instance;
    }
    addFromOAuth(kind : string) {
        return this._factory.loadFromOAuth(kind);
    }
    async completeOAuth(kind : string, url : string, session : Record<string, string>) {
        const instance = await this._factory.completeOAuth(kind, url, session);
        if (!instance)
            return null;
        await this.addDevice(instance);
        return instance;
    }
    addFromDiscovery(kind : string, publicData : Record<string, unknown>, privateData : Record<string, unknown>) {
        return this._factory.loadFromDiscovery(kind, publicData, privateData);
    }
    async completeDiscovery(instance : Tp.BaseDevice, delegate : Tp.ConfigDelegate) {
        await instance.completeDiscovery(delegate);
        await this.addDevice(instance);
        return instance;
    }
    async addInteractively(kind : string, delegate : Tp.ConfigDelegate) {
        const instance = await this._factory.loadInteractively(kind, delegate);
        await this.addDevice(instance);
        return instance;
    }

    private _removeDeviceFromCache(device : Tp.BaseDevice) {
        this._devices.delete(device.uniqueId!);
        device.descriptors.forEach((descriptor) => {
            this._byDescriptor.delete(descriptor);
        });
    }

    async removeDevice(device : Tp.BaseDevice) {
        this._removeDeviceFromCache(device);
        if (!device.isTransient)
            await this._syncdb.deleteOne(device.uniqueId!);

        return this._notifyDeviceRemoved(device);
    }

    hasDevice(uniqueId : string) {
        return this._devices.has(uniqueId);
    }

    getDevice(uniqueId : string) {
        return this._devices.get(uniqueId);
    }

    async reloadDevice(device : Tp.BaseDevice) {
        const state = device.serialize();

        await this._removeDeviceFromCache(device);
        await this._notifyDeviceRemoved(device);

        await this.loadOneDevice(state, false);
    }

    getCachedDeviceClasses() {
        return this._factory.getCachedDeviceClasses();
    }

    async updateDevicesOfKind(kind : string) {
        this.schemas.removeFromCache(kind);

        await this._factory.updateDeviceClass(kind);
        await this._reloadAllDevices(kind);
    }

    private async _reloadAllDevices(kind : string) {
        const devices = this._getValuesOfExactKind(kind);

        return Promise.all(devices.map((d) => {
            return this.reloadDevice(d);
        }));
    }

    private async _updateAll() {
        const kinds = new Map; // from kind to version

        for (const dev of this._devices.values())
            kinds.set(dev.kind, (dev.constructor as typeof Tp.BaseDevice).metadata.version);

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
