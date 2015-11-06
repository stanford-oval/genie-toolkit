// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Config = require('./config');

const assert = require('assert');
const fs = require('fs');
const lang = require('lang');
const Q = require('q');

const prefs = require('./prefs');
const Protocol = require('./protocol');
const ProxyManager = require('./proxy');
const PipeManager = require('./pipes');
const Tier = require('./tier_manager').Tier;

const ChannelStateBinder = new lang.Class({
    Name: 'ChannelStateBinder',

    _init: function(prefs) {
        this._prefs = prefs;
    },

    init: function(name) {
        this._cached = this._prefs.get(name);
        if (this._cached === undefined) {
            this._cached = {};
            this._prefs.set(name, this._cached);
        }
    },

    get: function(name) {
        return this._cached[name];
    },

    set: function(name, value) {
        this._cached[name] = value;
        this._prefs.changed();
    },
});

module.exports = new lang.Class({
    Name: 'ChannelFactory',
    $rpcMethods: [],

    _init: function(engine, tiers, deviceFactory) {
        this._engine = engine;
        this._cachedChannels = {};

        this._deviceFactory = deviceFactory;
        this._tierManager = tiers;
        this._proxyManager = new ProxyManager(tiers, this, engine.devices);
        this._pipeManager = new PipeManager(tiers, this._proxyManager);

        this._prefs = new prefs.FilePreferences(platform.getWritableDir() + '/channels.db');
    },

    start: function() {
        return Q();
    },

    stop: function() {
        return Q();
    },

    getProxyChannel: function(targetTier, device, kind, filters) {
        var targetChannelId = device.uniqueId + '-' + kind + '-' + Protocol.filters.makeString(filters);
        return this._getOpenedChannel(this._proxyManager.getProxyChannel(targetChannelId, targetTier,
                                                                         device, kind, filters));
    },

    _checkFactoryCaps: function(caps) {
        return caps.every(function(c) {
            if (c === 'channel-state')
                return true;
            else
                return platform.hasCapability(c);
        }.bind(this));
    },

    getChannel: function(device, kind) {
        // Named pipes are special in that we need some coordination
        // to ensure that we always have all proxies across all the tiers
        // So ask our trusty pipe manager for it
        //
        // (Note: we only follow this path for a request from ProxyManager)
        if (device.kind === 'thingengine-system' && kind === 'pipe')
            return this._pipeManager.getProxyNamedPipe(kind);

        var args = Array.prototype.slice.call(arguments, 2);

        return Q.try(function() {
            return this._deviceFactory.getSubmodule(device.kind, kind);
        }.bind(this)).then(function(factory) {
            var caps = factory.requiredCapabilities || [];
            if (!this._checkFactoryCaps(caps))
                throw new Error('Channel is not supported');

            var hasState = caps.indexOf('channel-state') >= 0;
            var channel;
            var state;
            if (hasState) {
                state = new ChannelStateBinder(this._prefs);
                channel = factory.createChannel.apply(factory, [this._engine, state, device].concat(args));
            } else {
                state = null;
                channel = factory.createChannel.apply(factory, [this._engine, device].concat(args));
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
    },

    _getOpenedChannel: function(promise) {
        return Q(promise).tap(function(channel) {
            console.log('Obtained channel ' + channel.uniqueId);
            return channel.open();
        });
    },

    // The following functions are "public" to BaseDevice
    // but nothing should be ever calling them
    // Use BaseDevice.getChannel() instead

    getOpenedChannel: function(device, kind, filters) {
        return this._getOpenedChannel(this.getChannel(device, kind, filters));
    },

    // A named pipe is a PipeChannel with the given name
    // It can be useful to communicate between different apps, potentially
    // running on different tiers
    //
    // The returned channel will be a source if the second parameter is 'r',
    // and a sink if it is 'w'
    //
    // Like getOpenedChannel, this is "public" to DeviceSelector (because pipes
    // are special-special-special), but *nothing* should ever call this outside
    // of core code
    getNamedPipe: function(name, mode) {
        if (mode !== 'r' && mode !== 'w')
            throw new Error('Invalid mode ' + mode);
        var source = mode === 'r';

        if (source)
            return this._getOpenedChannel(this._pipeManager.getLocalSourceNamedPipe(name));
        else
            return this._getOpenedChannel(this._pipeManager.getLocalSinkNamedPipe(name));
    },
});
