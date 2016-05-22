// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

const Tp = require('thingpedia');
const Tier = Tp.Tier;
const prefs = require('../util/prefs');
const Protocol = require('../tiers/protocol');
const ProxyManager = require('../tiers/proxy');
const PipeManager = require('../tiers/pipes');

class ChannelStateBinder {
    constructor(prefs) {
        this._prefs = prefs;
    }

    init(name) {
        this._cached = this._prefs.get(name);
        if (this._cached === undefined)
            this._prefs.set(name, this._cached = {});
    }

    get(name) {
        return this._cached[name];
    }

    set(name, value) {
        this._cached[name] = value;
        this._prefs.changed();
    }
}

module.exports = class ChannelFactory {
    constructor(engine, tiers, devices) {
        this._engine = engine;
        this._cachedChannels = {};

        this._devices = devices;
        this._deviceFactory = devices.factory;
        this._tierManager = tiers;
        this._proxyManager = new ProxyManager(tiers, this, engine.devices, engine.messaging);
        this._pipeManager = new PipeManager(tiers, this._proxyManager);

        this._prefs = new prefs.FilePreferences(this._engine.platform.getWritableDir() + '/channels.db');
    }

    _onDeviceRemoved(device) {
        var prefix = device.uniqueId + '-';
        for (var key in this._cachedChannels) {
            if (key.startsWith(prefix))
                delete this._cachedChannels[key];
        }
        this._prefs.keys().forEach(function(key) {
            if (key.startsWith(prefix))
                this._prefs.delete(key);
        }, this);
    }

    start() {
        this._deviceRemovedListener = this._onDeviceRemoved.bind(this);
        this._devices.on('object-removed', this._deviceRemovedListener);
        return Q();
    }

    stop() {
        this._devices.removeListener('object-removed', this._deviceRemovedListener);
        return Q();
    }

    _getProxyChannel(targetTier, device, kind, mode, params) {
        var targetChannelId = device.uniqueId + '-' + kind;
        if (mode === 'r')
            targetChannelId += '-' + Protocol.params.makeString(params);
        return this._proxyManager.getProxyChannel(targetChannelId, targetTier,
                                                  device, kind, mode, params);
    }

    _checkFactoryCaps(caps) {
        return caps.every(function(c) {
            if (c === 'channel-state')
                return true;
            else
                return this._engine.platform.hasCapability(c);
        }.bind(this));
    }

    getChannel(device, kind, mode, params) {
        // Named pipes are special in that we need some coordination
        // to ensure that we always have all proxies across all the tiers
        // So ask our trusty pipe manager for it
        //
        // (Note: we only follow this path for a request from ProxyManager)
        if (device === 'thingengine-pipe-system')
            return this._pipeManager.getProxyNamedPipe(kind);

        return Q.try(function() {
            if (mode === 'r')
                return device.getTriggerClass(kind);
            else if (mode === 'q')
                return device.getQueryClass(kind);
            else
                return device.getActionClass(kind);
        }).then(function(factory) {
            var caps = factory.requiredCapabilities || [];
            if (!this._checkFactoryCaps(caps))
                throw new Error('Channel is not supported');

            var hasState = caps.indexOf('channel-state') >= 0;
            var channel;
            var state;
            if (hasState) {
                state = new ChannelStateBinder(this._prefs);

                if (typeof factory === 'function') {
                    channel = new factory(this._engine, state, device, params);
                } else {
                    channel = factory.createChannel(this._engine, state, device, params);
                }
            } else {
                state = null;

                if (typeof factory === 'function') {
                    channel = new factory(this._engine, device, params);
                } else {
                    channel = factory.createChannel(this._engine, device, params);
                }
            }

            if (channel.filterString !== undefined)
                channel.uniqueId = device.uniqueId + '-' + kind + '-' + channel.filterString;
            else
                channel.uniqueId = device.uniqueId + '-' + kind;

            // deduplicate the channel now that we have the uniqueId
            if (channel.uniqueId in this._cachedChannels) {
                return this._cachedChannels[channel.uniqueId];
            } else {
                if (state)
                    state.init(channel.uniqueId);
                return this._cachedChannels[channel.uniqueId] = channel;
            }
        }.bind(this));
    }

    _getOpenedChannel(promise) {
        return Q(promise).tap(function(channel) {
            console.log('Obtained channel ' + channel.uniqueId);
            return channel.open();
        });
    }

    getOpenedChannel(device, id, mode, params) {
        if (device.ownerTier === this._tierManager.ownTier ||
            device.ownerTier === Tier.GLOBAL)
            return this._getOpenedChannel(this.getChannel(device, id, mode, params));
        else
            return this._getOpenedChannel(this._getProxyChannel(device.ownerTier, device, id, mode, params));
    }

    getNamedPipe(name, mode) {
        if (mode !== 'r' && mode !== 'w')
            throw new Error('Invalid mode ' + mode);
        var source = mode === 'r';

        if (source)
            return this._getOpenedChannel(this._pipeManager.getLocalSourceNamedPipe(name));
        else
            return this._getOpenedChannel(this._pipeManager.getLocalSinkNamedPipe(name));
    }
}
