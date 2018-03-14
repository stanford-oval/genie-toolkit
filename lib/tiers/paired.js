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

const crypto = require('crypto');

const Tp = require('thingpedia');
const Tier = Tp.Tier;
const tc = require('./tier_connections');
const IpAddress = require('../util/ip_address');

module.exports = class PairedEngineManager {
    constructor(platform, devices, tierManager) {
        this._platform = platform;
        this._devices = devices;
        this._tierManager = tierManager;

        this._listener = null;
    }

    _makeAuthToken() {
        var prefs = this._platform.getSharedPreferences();
        var authToken = prefs.get('auth-token');
        if (authToken === undefined) {
            // No auth token, generate one now with 256 random bits
            authToken = crypto.randomBytes(32).toString('hex');
            prefs.set('auth-token', authToken);
        }
        return authToken;
    }

    _onDeviceAdded(device) {
        if (!device.hasKind('thingengine-own'))
            return;

        // Added by syncdb because some other config-pairing app
        // created it, or added by us when we started
        // In any case, we're obviously already configured with
        // ourselves, so do nothing
        if (device.tier === this._tierManager.ownTier)
            return;
        // global is not really a tier, ignore it
        if (device.tier === Tier.GLOBAL)
            return;

        Promise.resolve().then(() => {
            if (device.tier === Tier.PHONE)
                return this._onPhoneAdded(device);
            else if (device.tier === Tier.SERVER)
                return this._onServerAdded(device);
            else if (device.tier === Tier.CLOUD)
                return this._onCloudAdded(device);
            else
                return Promise.resolve();
        }).then(() => {
            // If we don't have a connection to this tier, probably we
            // had the wrong settings when tier manager started up,
            // by now we should have fixed them, so try again
            if (!this._tierManager.isConnectable(device.tier))
                this._tierManager.reopenOne(device.tier);
        });
    }

    _onDeviceRemoved(device) {
        if (!device.hasKind('thingengine-own'))
            return;

        // wait what?
        if (device.tier === this._tierManager.ownTier) {
            console.error('ThingEngine for current tier removed, ignoring...');
            return;
        }
        // global is not really a tier, ignore it
        if (device.tier === Tier.GLOBAL) {
            console.error('ThingEngine global tier removed, ignoring...');
            return;
        }

        Promise.resolve().then(() => {
            if (device.tier === Tier.PHONE)
                return this._onPhoneRemoved(device);
            else if (device.tier === Tier.SERVER)
                return this._onServerRemoved(device);
            else if (device.tier === Tier.CLOUD)
                return this._onCloudRemoved(device);
            else
                return Promise.resolve();
        }).then(() => {
            // close and reopen the connection
            // probably reopening will do nothing, which is the goal of removing
            // the device (breaking sync)
            this._tierManager.reopenOne(device.tier);
        });
    }

    _onPhoneAdded(device) {
        // phone will be added to server or cloud by syncdb
        // there is nothing to do here, it has no useful information
        // because it operates always as a client
        return Promise.resolve();
    }

    _onPhoneRemoved(device) {
        // phone should basically be never removed, do nothing
        return Promise.resolve();
    }

    _onServerRemoved(device) {
        var prefs = this._platform.getSharedPreferences();
        prefs.set('server-address', undefined);

        return Promise.resolve();
    }

    _onServerAdded(device) {
        // server will be added to phone by injection from the platform
        // code (when you scan the QR code from the server config page)
        // or will be added to cloud by syncdb when server first connects
        // to cloud (and from there it will propagate to phone via syncdb)
        //
        // if we are a phone, in both cases, we need to make sure we
        // have the right config
        // in the injection case, the server might be in initial setup mode
        // (ie, no authToken, in which case we use the auth token we have)
        // if we are a cloud, we already know what we need to know
        // (cloud ID and auth token) because the frontend code set it up
        // for us, so do nothing
        if (this._tierManager.ownTier === Tier.PHONE) {
            // Note: no need for confirmation here, this is a thingengine
            // that we already know is paired
            console.log('Found ThingEngine ' + device.tier + ' at ' + device.host
                        + ' port ' + device.port);
            console.log('Autoconfiguring...');

            var host = device.host.indexOf(':') >= 0 ?
                ('[' + device.host + ']') : device.host;
            var serverAddress = 'http://' + host + ':' + device.port + '/websocket';
            var prefs = this._platform.getSharedPreferences();
            var oldServerAddress = prefs.get('server-address');
            if (oldServerAddress !== undefined) {
                // we already had a server address configured
                // two possibilities: one is a spurious syncdb device added
                // and the address is actually the same, in which case we
                // do nothing and live happily
                // the other is that the server moved somewhere else (or we first
                // got hold of the server through syncdb then the user picked
                // a different, working, address to configured in the phone)
                // in the latter case we close the old (and probably non
                // working) connection to the server
                if (oldServerAddress === serverAddress)
                    return Promise.resolve();

                return this._tierManager.closeOne(Tier.SERVER).then(() => {
                    return this._configureServerFromPhone(serverAddress);
                });
            } else {
                return this._configureServerFromPhone(serverAddress);
            }
        } else {
            return Promise.resolve();
        }
    }

    _configureServerFromPhone(serverAddress) {
        // The server may or may not be in initial setup mode, we don't
        // know
        // (one way it might not be in initial setup mode is that if this
        // a new phone, after a previous one was paired to the server,
        // or if the server was paired to the cloud first)
        // We just assume it is - if it is not, and we have the wrong
        // auth token, the server will just shut us down

        // Open a temporary connection with the server to set up the auth token
        // we pass undefined to ClientConnection to prevent it from doing its
        // own auth
        var connection = new tc.ClientConnection(serverAddress, undefined);
        return connection.open().then(() => {
            console.log('Configuring server with auth token');
            connection.send({control:'set-auth-token', token: this._makeAuthToken()});

            // note: we could send the cloud id here as well, but we don't
            // syncdb will send the thingengine-cloud from us to the server
            // at which point config-pairing on the server will pick it up
            // and configure itself

            return new Promise((callback, errback) => {
                connection.on('message', (msg) => {
                    connection.close().then(() => {
                        if (msg.control !== 'auth-token-ok') {
                            console.log('Server rejected pairing request');
                            callback();
                        } else {
                            console.log('Server accepted pairing request');
                            var prefs = this._platform.getSharedPreferences();
                            prefs.set('server-address', serverAddress);
                            callback();
                        }
                    }, errback);
                });
            });
        });
    }

    _onCloudRemoved(device) {
        var prefs = this._platform.getSharedPreferences();
        prefs.set('cloud-id', undefined);

        return Promise.resolve();
    }

    _onCloudAdded(device) {
        // cloud will be added to phone or server by injection in the
        // respective platform layers, or by syncdb between them
        // in all cases, we just take the cloudId from the device,
        // set it in our settings, and tell tiermanager to reconnect

        var prefs = this._platform.getSharedPreferences();
        var oldCloudId = prefs.get('cloud-id');
        if (oldCloudId !== undefined) {
            // we already had a cloud ID configured
            // this should never happen, but for robustness we let it
            // go silently if the cloud id is identical, and complain
            // very loudly if the cloud id is different
            // but still do nothing
            // cloud id is immutable
            if (oldCloudId !== device.cloudId)
                console.error('Attempting to change the stored cloud ID! This should never happen!');

            this._platform.setDeveloperKey(device.developerKey);
            return Promise.resolve();
        }

        prefs.set('cloud-id', device.cloudId);
        this._platform.setDeveloperKey(device.developerKey);
        return Promise.resolve();
    }

    _addPhoneToDB() {
        return this._devices.loadOneDevice({ kind: 'org.thingpedia.builtin.thingengine',
                                             tier: Tier.PHONE,
                                             own: true }, true);
    }

    _addServerToDB() {
        return IpAddress.getServerName().then((host) => {
            return this._devices.loadOneDevice({ kind: 'org.thingpedia.builtin.thingengine',
                                                 tier: Tier.SERVER,
                                                 host: host,
                                                 port: 3000, // FIXME: hardcoded
                                                 own: true }, true);
        });
    }

    _addCloudToDB() {
        return this._devices.loadOneDevice({ kind: 'org.thingpedia.builtin.thingengine',
                                             tier: Tier.CLOUD,
                                             cloudId: this._platform.getCloudId(),
                                             developerKey: this._platform.getDeveloperKey(),
                                             own: true }, true);
    }

    _addSelfToDB() {
        if (this._devices.hasDevice('thingengine-own-' + this._tierManager.ownTier))
            return Promise.resolve();

        if (this._tierManager.ownTier === Tier.PHONE)
            return this._addPhoneToDB();
        else if (this._tierManager.ownTier === Tier.SERVER)
            return this._addServerToDB();
        else
            return this._addCloudToDB();
    }

    _addPlatformToDB() {
        if (this._tierManager.ownTier === Tier.PHONE) {
            if (!this._devices.hasDevice('org.thingpedia.builtin.thingengine.phone'))
                return this._addToDB('thingengine.phone');
        }

        return Promise.resolve();
    }

    _addToDB(builtin) {
        return this._devices.loadOneDevice({ kind: 'org.thingpedia.builtin.' + builtin }, true);
    }

    start() {
        // Start watching for changes to the device database
        this._listener = this._onDeviceAdded.bind(this);
        this._devices.on('device-added', this._listener);

        if (!this._tierManager.isConnectable(Tier.SERVER) &&
            this._devices.hasDevice('thingengine-own-server'))
            this._onServerAdded(this._devices.getDevice('thingengine-own-server'));
        if (!this._tierManager.isConnectable(Tier.CLOUD) &&
            this._devices.hasDevice('thingengine-own-cloud'))
            this._onCloudAdded(this._devices.getDevice('thingengine-own-cloud'));

        // Make sure that the builtins are available
        return Promise.all([
            this._addToDB('thingengine.builtin'),
            this._addToDB('thingengine.remote'),
            this._addToDB('test'),
            this._addSelfToDB(),
            this._addPlatformToDB()
        ]);
    }

    stop() {
        if (this._listener !== null)
            this._devices.removeListener('device-added', this._listener);
        this._listener = null;
        return Promise.resolve();
    }
};