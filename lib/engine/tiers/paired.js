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


import * as crypto from 'crypto';

import * as Tp from 'thingpedia';
const Tier = Tp.Tier;
import * as IpAddress from '../util/ip_address';
import Builtins from '../devices/builtins';

export default class PairedEngineManager {
    constructor(platform, devices, deviceFactory, tierManager) {
        this._platform = platform;
        this._devices = devices;
        this._deviceFactory = deviceFactory;
        this._tierManager = tierManager;

        this._deviceAddedListener = this._onDeviceAdded.bind(this);
        this._deviceRemovedListener = this._onDeviceRemoved.bind(this);
    }

    _makeAuthToken() {
        let prefs = this._platform.getSharedPreferences();
        let authToken = prefs.get('auth-token');
        if (authToken === undefined) {
            // No auth token, generate one now with 256 random bits
            authToken = crypto.randomBytes(32).toString('hex');
            prefs.set('auth-token', authToken);
        }
        return authToken;
    }

    _onDeviceAdded(device) {
        if (device.kind !== 'org.thingpedia.builtin.thingengine')
            return;

        // Added by syncdb because some other config-pairing app
        // created it, or added by us when we started
        // In any case, we're obviously already configured with
        // ourselves, so do nothing
        if (device.address === this._tierManager.ownAddress)
            return;
        // global is not really a tier, ignore it
        if (device.tier === Tier.GLOBAL)
            return;

        Promise.resolve().then(async () => {
            if (device.tier === Tier.SERVER)
                await this._onServerAdded(device);
            else if (device.tier === Tier.CLOUD)
                await this._onCloudAdded(device);

            // If we don't have a connection to this tier, probably we
            // had the wrong settings when tier manager started up,
            // by now we should have fixed them, so try again
            if (!this._tierManager.isConnected(device.address))
                await this._tierManager.tryConnect(device.address);
        }).catch((e) => {
            console.error('Failed to connect to ' + device.address + ': ' + e.message);
        });
    }

    _onDeviceRemoved(device) {
        if (device.kind !== 'org.thingpedia.builtin.thingengine')
            return;

        // wait what?
        if (device.address === this._tierManager.ownAddress) {
            console.error('ThingEngine for current device removed, ignoring...');
            return;
        }
        // global is not really a tier, ignore it
        if (device.tier === Tier.GLOBAL) {
            console.error('ThingEngine global tier removed, ignoring...');
            return;
        }

        if (device.tier === Tier.SERVER)
            this._tierManager.removeServerConfig(device.address);
        else if (device.tier === Tier.CLOUD)
            this._tierManager.removeCloudConfig();

        // close the connection, which is the goal of removing
        // the device (breaking sync)
        this._tierManager.closeConnection(device.address).catch((e) => {
            console.error('Failed to close connection to ' + device.address + ': ' + e.message);
        });
    }

    async _onServerAdded(device) {
        // server will be added to phone by injection from the platform
        // code (when you scan the QR code from the server config page)
        // or will be added to cloud by syncdb when server first connects
        // to cloud (and from there it will propagate to phone via syncdb)
        //
        // if we are a phone, in both cases, we need to make sure we
        // have the right config
        // if we are a cloud, we already know what we need to know
        // (cloud ID and auth token) because the frontend code set it up
        // for us, so do nothing
        if (this._tierManager.ownTier === Tier.CLOUD)
            return;

        // Note: no need for confirmation here, this is a thingengine
        // that we already know is paired
        console.log('Found ThingEngine ' + device.tier + ' at ' + device.host
                    + ' port ' + device.port);
        console.log('Autoconfiguring...');

        const host = device.host.indexOf(':') >= 0 ?
            ('[' + device.host + ']') : device.host;
        const url = 'http://' + host + ':' + device.port + '/api/sync';
        const prefs = this._platform.getSharedPreferences();

        let servers = prefs.get('servers');
        if (!servers) {
            servers = {};
            prefs.set('servers', {});
        }

        if (servers[device.identity]) {
            const oldurl = servers[device.identity].url;

            // we already had a server address configured
            // two possibilities: one is a spurious syncdb device added
            // and the address is actually the same, in which case we
            // do nothing and live happily
            // the other is that the server moved somewhere else (or we first
            // got hold of the server through syncdb then the user picked
            // a different, working, address to configured in the phone)
            // in the latter case we close the old (and probably non
            // working) connection to the server
            if (oldurl === url)
                return;

            await this._tierManager.closeConnection(device.address);
        }

        servers[device.identity] = { url };
        prefs.changed('servers');
        this._tierManager.addServerConfig({ url });
    }

    async _onCloudAdded(device) {
        // cloud will be added to phone or server by injection in the
        // respective platform layers, or by syncdb between them
        // in all cases, we just take the cloudId from the device,
        // set it in our settings, and tell tiermanager to reconnect

        let prefs = this._platform.getSharedPreferences();
        let oldCloudId = prefs.get('cloud-id');
        if (oldCloudId !== undefined) {
            // we already had a cloud ID configured
            // this should never happen, but for robustness we let it
            // go silently if the cloud id is identical, and complain
            // if the cloud id is different
            if (oldCloudId !== device.cloudId)
                console.error('Attempting to change the stored cloud ID! This should never happen!');
        }

        prefs.set('cloud-id', device.cloudId);
        this._tierManager.addCloudConfig();
    }

    async _loadDevice(state) {
        const instance = await this._deviceFactory.loadSerialized(state.kind, state);
        await this._devices.addDevice(instance);
    }

    _addPhoneToDB() {
        return this._loadDevice({
            kind: 'org.thingpedia.builtin.thingengine',
            tier: Tier.PHONE,
            identity: this._tierManager.ownIdentity,
            own: true });
    }

    _addDesktopToDB() {
        return this._loadDevice({
            kind: 'org.thingpedia.builtin.thingengine',
            tier: Tier.DESKTOP,
            identity: this._tierManager.ownIdentity,
            own: true });
    }

    _addServerToDB() {
        return IpAddress.getServerName().then((host) => {
            return this._loadDevice({
                kind: 'org.thingpedia.builtin.thingengine',
                tier: Tier.SERVER,
                identity: this._tierManager.ownIdentity,
                host: host,
                port: parseInt(process.env.PORT) || 3000,
                own: true });
        });
    }

    _addCloudToDB() {
        return this._loadDevice({
            kind: 'org.thingpedia.builtin.thingengine',
            tier: Tier.CLOUD,
            identity: '',
            cloudId: this._platform.getCloudId(),
            developerKey: this._platform.getDeveloperKey(),
            own: true });
    }

    _addSelfToDB() {
        if (this._devices.hasDevice('thingengine-own-' + this._tierManager.ownAddress))
            return Promise.resolve();

        switch (this._tierManager.ownTier) {
        case Tier.PHONE:
            return this._addPhoneToDB();
        case Tier.SERVER:
            return this._addServerToDB();
        case Tier.DESKTOP:
            return this._addDesktopToDB();
        case Tier.CLOUD:
            return this._addCloudToDB();
        default:
            throw new Error('Invalid own tier ' + this._tierManager.ownTier);
        }
    }

    async _addPlatformToDB() {
        let platdev = await this._platform.getPlatformDevice();
        if (!platdev)
            return;

        let kind;
        if (typeof platdev === 'object') {
            Builtins[platdev.kind] = platdev;
            kind = platdev.kind;
        } else {
            kind = platdev;
            if (!kind.startsWith('org.thingpedia.builtin.thingengine.'))
                kind = 'org.thingpedia.builtin.thingengine.' + kind;
        }

        if (this._devices.hasDevice(kind))
            return;

        await this._addToDB(kind);
    }

    _addToDB(kind) {
        return this._loadDevice({ kind });
    }

    start() {
        // Start watching for changes to the device database
        this._devices.on('device-added', this._deviceAddedListener);
        this._devices.on('device-removed', this._deviceRemovedListener);

        // Make sure that the builtins are available
        return Promise.all([
            this._addToDB('org.thingpedia.builtin.thingengine.builtin'),
            this._addToDB('org.thingpedia.builtin.test'),
            this._addSelfToDB(),
            this._addPlatformToDB()
        ]);
    }

    stop() {
        this._devices.removeListener('device-added', this._deviceAddedListener);
        this._devices.removeListener('device-removed', this._deviceRemovedListener);
        return Promise.resolve();
    }
}
