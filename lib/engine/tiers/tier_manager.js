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


import * as events from 'events';
import * as crypto from 'crypto';

import * as tc from './tier_connections';

const Tier = {
    GLOBAL: 'global', // a non-tier, represents some builtin devices
    PHONE: 'phone',
    SERVER: 'server',
    CLOUD: 'cloud',
    DESKTOP: 'desktop',
};
const INITIAL_RECONNECTION_BACKOFF = 262144;
const MAX_RECONNECTION_BACKOFF = 76527504; // approx 21h

// Note: this should be the only module (togheter with
// tier_connections) in the engine to have intimate knowledge of what
// a platform is, and host platform specific code; other code
// (especially apps, except for a few system apps like 'server-config' and 'cloud-config')
// should be platform agnostic and rely on platform capabilities
// instead

export default class TierManager extends events.EventEmitter {
    constructor(platform, cloudUrl) {
        super();

        this._platform = platform;
        this._cloudUrl = cloudUrl;

        this.devices = null;
        this.ownTier = null;

        if (platform.type === 'android' || platform.type === 'ios')
            this.ownTier = Tier.PHONE;
        else if (platform.type === 'server')
            this.ownTier = Tier.SERVER;
        else if (platform.type === 'cloud')
            this.ownTier = Tier.CLOUD;
        else // everything else is desktop by default
            this.ownTier = Tier.DESKTOP;

        // we assign each device a unique identity, except for cloud
        // there is only one cloud
        if (platform.type !== 'cloud') {
            const prefs = platform.getSharedPreferences();
            let id = prefs.get('cloud-sync-device-id');
            if (!id) {
                id = crypto.randomBytes(8).toString('hex');
                prefs.set('cloud-sync-device-id', id);
            }
            this.ownIdentity = ':' + id;
        } else {
            this.ownIdentity = '';
        }

        this._serverSocket = null;

        this._clientConfigurations = {};
        this._clientSockets = {};
        this._backoffs = {};
        this._reconnectTimeouts = {};

        this._handlers = {};
    }

    get ownAddress() {
        return this.ownTier + this.ownIdentity;
    }

    _backoffTimer(address) {
        let backoff = this._backoffs[address];
        if (backoff === undefined)
            backoff = this._backoffs[address] = INITIAL_RECONNECTION_BACKOFF;

        // initial timer is approx 4 minutes (2**18 ms), grows
        // exponentially times 1.5 up to approx 1 day
        // no need to do integer math, 1.5 can be express with perfect
        // precision as double
        this._backoffs[address] *= 1.5;
        if (this._backoffs[address] >= MAX_RECONNECTION_BACKOFF)
            this._backoffs[address] = MAX_RECONNECTION_BACKOFF;
        return backoff;
    }

    async tryConnect(address) {
        if (address === this.ownAddress)
            return;
        if (this._clientSockets[address])
            return;
        await this._tryOpenClient(address);
    }
    async _tryOpenClient(address) {
        const config = this._clientConfigurations[address];
        if (!config)
            return;

        const socket = new tc.ClientConnection(config.url, this.ownAddress, this._platform.getAuthToken());
        this._clientSockets[address] = socket;

        socket.on('failed', () => {
            console.log('Tier connection to ' + address + ' failed');

            // note: messages that failed to write are lost
            // when the socket is connected again, we will initiate sync again
            delete this._clientSockets[address];
            this.emit('disconnected', address);

            // Try again at some point in the future
            let timer = this._backoffTimer(address);
            console.log('Trying again in ' + Math.floor(timer/60000) + ' minutes');
            this._reconnectTimeouts[address] = setTimeout(() => {
                this._reconnectTimeouts[address] = undefined;
                this._tryOpenClient(address);
            }, timer);
        });

        socket.on('message', (msg, from) => {
            if (this._clientSockets[address] !== socket) // robustness
                return;
            this._routeMessage(address, msg);
        });

        const success = await socket.open();
        if (success)
            this.emit('connected', address);
    }

    async _tryOpenServer() {
        this._serverSocket = new tc.ServerConnection(this._platform);
        this._serverSocket.on('message', (msg, from) => {
            this._routeMessage(from, msg);
        });
        this._serverSocket.on('connected', (remote) => {
            this.emit('connected', remote);
        });

        await this._serverSocket.open();
    }

    addCloudConfig() {
        const cloudId = this._platform.getCloudId();
        if (!cloudId)
            return;

        this._clientConfigurations['cloud'] = {
            url: this._cloudUrl + '/ws/' + this._platform.getCloudId()
        };
    }
    removeCloudConfig() {
        const prefs = this._platform.getSharedPreferences();
        prefs.set('cloud-id', undefined);

        delete this._clientConfigurations['cloud'];
    }
    _addAllServerConfigs() {
        const prefs = this._platform.getSharedPreferences();

        const servers = prefs.get('servers') || {};
        for (let identity in servers)
            this._clientConfigurations['server:' + identity] = servers[identity];
    }
    addServerConfig(identity, config) {
        this._clientConfigurations['server:' + identity] = config;
    }
    removeServerConfig(identity) {
        delete this._clientConfigurations['server:' + identity];

        const prefs = this._platform.getSharedPreferences();
        let servers = prefs.get('servers');
        if (!servers)
            return;
        delete servers[identity];
        prefs.changed('servers');
    }

    async start() {
        switch (this.ownTier) {
        case Tier.PHONE:
        case Tier.DESKTOP:
            this.addCloudConfig();
            this._addAllServerConfigs();
            break;

        case Tier.SERVER:
            this.addCloudConfig();

            // fallthrough
        case Tier.CLOUD:
            await this._tryOpenServer();
            break;

        default:
            throw new Error('Invalid own tier ' + this._tierManager.ownTier);
        }

        await Promise.all(Object.keys(this._clientConfigurations).map((address) => {
            return this._tryOpenClient(address);
        }));
    }

    async stop() {
        for (const address in this._reconnectTimeouts) {
            const timeout = this._reconnectTimeouts[address];
            if (timeout)
                clearTimeout(timeout);
        }

        await Promise.all(Object.values(this._clientSockets).map((s) => s.close()));
    }

    registerHandler(target, handler) {
        if (target in this._handlers)
            throw new Error('Handler for target ' + target + ' already registered');

        this._handlers[target] = handler;
    }

    _routeMessage(address, msg) {
        if (msg.control)
            throw new Error('Unexpected control message in TierManager');

        let target = msg.target;
        if (target in this._handlers)
            this._handlers[target](address, msg);
        else
            console.error('Message target ' + target + ' not recognized');
    }

    isClientTier(address) {
        return address in this._clientSockets;
    }

    isConnected(address) {
        if (address in this._clientSockets)
            return true;
        if (!this._serverSocket)
            return false;
        return this._serverSocket.isConnected(address);
    }

    async closeConnection(address) {
        if (address in this._clientSockets) {
            await this._clientSockets[address].close();
            delete this._clientSockets[address];
            this.emit('disconnected', address);
        } else if (this._serverSocket) {
            await this._serverSocket.closeOne(address);
        }
    }

    getClientConnections() {
        return Object.keys(this._clientSockets);
    }

    async sendTo(address, msg) {
        if (address in this._clientSockets)
            await this._clientSockets[address].send(msg);
        else if (this._serverSocket && this._serverSocket.isConnected(address))
            await this._serverSocket.send(msg, address);

        // if there is no open connection to address,
        // drop the message on the floor
        //
        // the client will reinitiate sync soon
    }

    sendToAll(msg) {
        if (this._serverSocket)
            this._serverSocket.send(msg);
        for (let target in this._clientSockets)
            this._clientSockets[target].send(msg);
    }
}

module.exports.Tier = Tier;
