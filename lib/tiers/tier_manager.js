// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Config = require('../config');

const events = require('events');
const Q = require('q');

const tc = require('./tier_connections');

const Tier = {
    GLOBAL: 'global', // a non-tier, represents some builtin devices
    PHONE: 'phone',
    SERVER: 'server',
    CLOUD: 'cloud',
};
const ALL_TIERS = [Tier.PHONE, Tier.SERVER, Tier.CLOUD];

// Note: this should be the only module (togheter with
// tier_connections) in the engine to have intimate knowledge of what
// a platform is, and host platform specific code; other code
// (especially apps, except for a few system apps like 'server-config' and 'cloud-config')
// should be platform agnostic and rely on platform capabilities
// instead

module.exports = class TierManager extends events.EventEmitter {
    constructor(platform) {
        super();

        this._platform = platform;
        this.devices = null;
        this.ownTier = null;

        if (platform.type === 'android' || platform.type === 'ios')
            this.ownTier = Tier.PHONE;
        else if (platform.type === 'server' || platform.type === 'testing')
            this.ownTier = Tier.SERVER;
        else if (platform.type === 'cloud')
            this.ownTier = Tier.CLOUD;
        else
            throw new Error('Unable to determine currently running tier');

        console.log('Tier manager initialized for ' + this.ownTier);

        var tierOpens = {};
        this._tierOpens = tierOpens;
        var tierSockets = {};
        this._tierSockets = tierSockets;

        // initial timer is approx 4 minutes (2**18 ms), grows
        // exponentially times 1.5 up to approx 1 day
        var tierBackoffs = {};
        this._tierBackoffs = tierBackoffs;

        var tierOutgoingBuffers = {};
        this._tierOutgoingBuffers = tierOutgoingBuffers;

        var tierConfigured = {};
        this._tierConfigured = tierConfigured;

        ALL_TIERS.forEach(function(t) {
            tierOpens[t] = null;
            tierSockets[t] = null;
            tierBackoffs[t] = 262144;
            tierOutgoingBuffers[t] = [];
            tierConfigured[t] = false;
        });

        this._handlers = {};
    }

    _backoffTimer(tier) {
        var backoff = this._tierBackoffs[tier];
        // no need to do integer math, 1.5 can be express with perfect
        // precision as double
        this._tierBackoffs[tier] *= 1.5;
        if (this._tierBackoffs[tier] >= 76527504) // approx 21h
            this._tierBackoffs[tier] = 76527504;
        return backoff;
    }

    _tryOpenOne(tier) {
        var f = this._tierOpens[tier];
        if (f === null) {
            this._tierConfigured[tier] = false;
            this._tierSockets[tier] = null;
            return null;
        }
        var socket = f();
        if (socket === null) {
            this._tierConfigured[tier] = false;
            this._tierSockets[tier] = null;
            return null;
        }

        this._tierConfigured[tier] = true;
        this._tierSockets[tier] = socket;
        socket.on('failed', function(lostMessages) {
            console.log('Tier connection to ' + tier + ' failed');
            // adopt the outgoing messages that the socket did not write
            this._tierOutgoingBuffers[tier] = lostMessages.concat(this._tierOutgoingBuffers[tier]);
            this._tierSockets[tier] = null;

            this.emit('disconnected', tier);

            // Try again at some point in the future
            var timer = this._backoffTimer(tier);
            console.log('Trying again in ' + Math.floor(timer/60000) + ' minutes');
            setTimeout(function() {
                this._tryOpenOne(tier).done();
            }.bind(this), timer);
        }.bind(this));

        socket.on('message', function(msg, from) {
            if (this._tierSockets[tier] !== socket) // robustness
                return;

            if (from !== undefined)
                this._routeMessage(from, msg);
            else
                this._routeMessage(tier, msg);
        }.bind(this));

        return socket.open().then(function(success) {
            if (success) {
                var buffer = this._tierOutgoingBuffers[tier];
                this._tierOutgoingBuffers[tier] = [];
                socket.sendMany(buffer);

                if (socket.isClient) {
                    this.emit('connected', tier);
                } else {
                    socket.on('connected', function(remote) {
                        this.emit('connected', remote);
                    }.bind(this));
                }
            }
        }.bind(this));
    }

    _openAll() {
        var promises = [];
        for (var i = 0; i < ALL_TIERS.length; i++) {
            var p = this._tryOpenOne(ALL_TIERS[i]);
            if (p !== null)
                promises.push(p);
        }

        return Q.all(promises);
    }

    _openPhone() {
        var prefs = this._platform.getSharedPreferences();

        var toPhone = null;
        var toServer = function() {
            var authToken = prefs.get('auth-token');
            var serverAddress = prefs.get('server-address');
            if (serverAddress !== undefined)
                return new tc.ClientConnection(serverAddress, Tier.PHONE,
                                               Tier.SERVER, authToken);
            else
                return null;
        };
        var toCloud = function() {
            var authToken = prefs.get('auth-token');
            var cloudId = prefs.get('cloud-id');
            if (cloudId !== undefined)
                return new tc.ClientConnection(Config.THINGENGINE_URL + '/ws/' + cloudId,
                                               Tier.PHONE, Tier.CLOUD, authToken);
            else
                return null;
        };

        this._tierOpens[Tier.PHONE] = toPhone;
        this._tierOpens[Tier.SERVER] = toServer;
        this._tierOpens[Tier.CLOUD] = toCloud;
        return this._openAll();
    }

    _openServer() {
        var prefs = this._platform.getSharedPreferences();

        var authToken = prefs.get('auth-token');
        if (authToken === undefined) {
            // If there is no auth token configured, we're in initial setup mode
            // In this mode, we'll allow any connection from a phone
            // but we don't connect to the cloud
            console.log('Server starting in initial setup mode...');
        }

        var platform = this._platform;
        var toPhone = function() {
            return new tc.ServerConnection(platform, [Tier.PHONE]);
        }
        var toServer = null;
        var toCloud = function() {
            var authToken = prefs.get('auth-token');
            var cloudId = prefs.get('cloud-id');
            if (cloudId !== undefined && authToken !== undefined) {
                var url;
                if (process.env.THINGENGINE_CLOUD_URL)
                    url = process.env.THINGENGINE_CLOUD_URL;
                else
                    url = Config.THINGENGINE_URL;
                return new tc.ClientConnection(url + '/ws/' + cloudId,
                                               Tier.SERVER, Tier.CLOUD, authToken);
            } else {
                return null;
            }
        }

        this._tierOpens[Tier.PHONE] = toPhone;
        this._tierOpens[Tier.SERVER] = toServer;
        this._tierOpens[Tier.CLOUD] = toCloud;
        return this._openAll();
    }

    _openCloud() {
        var authToken = this._platform.getAuthToken();
        if (authToken === undefined) {
            // Crash
            throw new Error('Cloud platform without a valid auth token!');
        }

        var cloudId = this._platform.getCloudId();
        if (cloudId === undefined) {
            // Crash
            throw new Error('Cloud platform without a valid cloud id!');
        }

        var platform = this._platform;
        var toPhone = function() {
            return new tc.ServerConnection(platform, [Tier.PHONE, Tier.SERVER]);
        }
        var toServer = null;
        var toCloud = null;
        this._tierOpens[Tier.PHONE] = toPhone;
        this._tierOpens[Tier.SERVER] = toServer;
        this._tierOpens[Tier.CLOUD] = toCloud;
        return this._openAll();
    }

    start() {
        switch(this.ownTier) {
        case Tier.PHONE:
            return this._openPhone();
        case Tier.SERVER:
            return this._openServer();
        case Tier.CLOUD:
            return this._openCloud();
        }
    }

    closeOne(tier) {
        if (this._tierSockets[tier] !== null) {
            if (this._tierSockets[tier].isServer) {
                return this._tierSockets[tier].closeOne(tier);
            } else {
                return this._tierSockets[tier].close().then(function() {
                    this._tierSockets[tier] = null;
                }.bind(this));
            }
        } else {
            return Q();
        }
    }

    stop() {
        var promises = [];
        ALL_TIERS.forEach(function(t) {
            var s = this._tierSockets[t];
            if (s !== null)
                promises.push(s.close());
        }, this);

        return Q.all(promises);
    }

    reopenOne(tier) {
        return this.closeOne(tier).then(function() {
            return this._tryOpenOne(tier);
        }.bind(this));
    }

    registerHandler(target, handler) {
        if (target in this._handlers)
            throw new Error('Handler for target ' + target + ' already registered');

        this._handlers[target] = handler;
    }

    _routeMessage(tier, msg) {
        if (msg.control)
            throw new Error('Unexpected control message in TierManager');

        var target = msg.target;
        if (target in this._handlers) {
            this._handlers[target](tier, msg);
        } else {
            console.error('Message target ' + target + ' not recognized');
        }
    }

    isClientTier(tier) {
        return this._tierSockets[tier] !== null &&
            this._tierSockets[tier].isClient;
    }

    isConnected(tier) {
        if (this.ownTier === Tier.CLOUD) {
            return this._tierSockets[Tier.PHONE].isConnected(tier);
        } else {
            return this._tierSockets[tier] !== null &&
                (this._tierSockets[tier].isClient ||
                 this._tierSockets[tier].isConnected(tier));
        }
    }

    // This function is very unreliable! Don't use outside of devices/paired.js
    isConnectable(tier) {
        if (this.ownTier === Tier.CLOUD)
            // for cloud we only have server connections, so we don't really know
            return true;
        else
            return this._tierConfigured[tier];
    }

    // This is the public API used by BaseDevice to compute where to host a device
    isConfigured(tier) {
        // defensive programming (and races with devices/paired.js)
        if (tier === this.ownTier)
            return true;
        return this.devices.hasDevice('thingengine-own-' + tier);
    }

    getConnectedClientTiers() {
        var tiers = [];
        for (var i = 0; i < ALL_TIERS.length; i++) {
            var tier = ALL_TIERS[i];
            if (this._tierSockets[tier] === null)
                continue;
            if (!this._tierSockets[tier].isClient)
                continue;
            tiers.push(tier);
        }
        return tiers;
    }

    getOtherTiers() {
        var tiers = [];
        for (var i = 0; i < ALL_TIERS.length; i++) {
            var tier = ALL_TIERS[i];
            if (tier === this.ownTier)
                continue;
            tiers.push(tier);
        }
        return tiers;
    }

    getAllConfiguredTiers() {
        var tiers = [];
        for (var i = 0; i < ALL_TIERS.length; i++) {
            var tier = ALL_TIERS[i];
            if (!this.isConfigured(tier))
                continue;
            tiers.push(tier);
        }
        return tiers;
    }

    sendTo(tier, msg) {
        if (this.ownTier === Tier.CLOUD) {
            this._tierSockets[Tier.PHONE].send(msg, tier);
        } else if (this._tierSockets[tier] !== null) {
            var s = this._tierSockets[tier];
            if (s.isServer)
                s.send(msg, tier);
            else
                s.send(msg);
        } else {
            this._tierOutgoingBuffers[tier].push(msg);
        }
    }

    sendToAll(msg) {
        ALL_TIERS.forEach(function(t) {
            var s = this._tierSockets[t];
            if (s !== null)
                s.send(msg);
        }, this);
    }
}

module.exports.Tier = Tier;
