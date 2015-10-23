// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Config = require('./config');

const fs = require('fs');
const lang = require('lang');
const Q = require('q');

const prefs = require('./prefs');
const ModuleDownloader = require('./module_downloader');
const ProxyManager = require('./proxy');
const PipeManager = require('./pipes');
const Tier = require('./tier_manager').Tier;

const ChannelStateBinder = new lang.Class({
    Name: 'ChannelStateBinder',

    _init: function(name, prefs) {
        this._cached = prefs.get(name);
        if (this._cached === undefined) {
            this._cached = {};
            prefs.set(name, this._cached);
        }
        this._prefs = prefs;
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

    _init: function(engine, tiers) {
        this._engine = engine;
        this._cachedChannels = {};

        this._downloader = new ModuleDownloader('channels');
        this._tierManager = tiers;
        this._proxyManager = new ProxyManager(tiers, this, engine.devices);
        this._pipeManager = new PipeManager(tiers, this._proxyManager);

        if (this._tierManager.ownTier === Tier.SERVER)
            this._prefs = new prefs.FilePreferences(platform.getWritableDir() + '/channels.db');
        else
            this._prefs = null;
    },

    start: function() {
        return Q();
    },

    stop: function() {
        return Q();
    },

    _getProxyChannel: function(targetChannelId, kind, caps, args) {
        // FINISHME!! Be smarter in choosing where to run this channel
        // (and factor CLOUD in the decision)

        var targetTier;
        if (c.indexOf('ui-manager') >= 0)
            targetTier = Tier.CLOUD;
        else if (this._tierManager.ownTier == Tier.PHONE)
            targetTier = Tier.SERVER;
        else
            targetTier = Tier.PHONE;

        return this._proxyManager.getProxyChannel(targetChannelId, targetTier, [kind].concat(args));
    },

    _checkFactoryCaps: function(caps) {
        return caps.every(function(c) {
            if (c === 'channel-state')
                return this._tierManager.ownTier === Tier.SERVER;
            else if (c === 'ui-manager')
                return this._tierManager.ownTier === Tier.CLOUD;
            else
                return platform.hasCapability(c);
        }.bind(this));
    },

    _getChannelInternal: function(useProxy, args) {
        var kind = args[0];
        args = Array.prototype.slice.call(args, 1);

        // Named pipes are special in that we need some coordination
        // to ensure that we always have all proxies across all the tiers
        // So ask our trusty pipe manager for it
        //
        // (Note: we only follow this path for a request from ProxyManager)
        if (kind === 'pipe')
            return this._pipeManager.getProxyNamedPipe(args[0]);

        var fullId = kind + '-' + args.map(function(arg) {
            if (typeof arg === 'string')
                return arg;
            else if (arg.uniqueId !== undefined)
                return arg.uniqueId;
            else
                return String(arg);
        }).join('-');

        if (fullId in this._cachedChannels)
            return this._cachedChannels[fullId];

        var subkind;
        if (args[0] && args[0].kind !== undefined && kind.startsWith(args[0].kind)) {
            subkind = kind.substr(args[0].kind.length + 1);
            kind = args[0].kind;
        } else {
            subkind = null;
        }

        return this._cachedChannels[fullId] = Q.try(function() {
            if (subkind != null) {
                return this._engine.devices.factory.getSubmodule(kind, subkind)
                    .catch(function(e) {
                        return this._downloader.getModule(kind + '-' + subkind);
                    }.bind(this));
            } else {
                return this._downloader.getModule(kind);
            }
        }.bind(this)).then(function(factory) {
            var caps = factory.requiredCapabilities || [];
            if (!this._checkFactoryCaps(caps)) {
                // uh oh! channel does not work, try with a proxy channel

                if (useProxy) {
                    return this._getProxyChannel(fullId, kind, caps, args);
                } else {
                    throw new Error('Channel is not supported but proxy channel is not allowed');
                }
            } else {
                var hasState = caps.indexOf('channel-state') >= 0;
                var channel;
                if (hasState)
                    channel = factory.createChannel.apply(factory, [this._engine, new ChannelStateBinder(fullId, this._prefs)].concat(args));
                else
                    channel = factory.createChannel.apply(factory, [this._engine].concat(args));
                channel.uniqueId = fullId;
                return channel;
            }
        }.bind(this));
    },

    _getOpenedChannel: function(promise) {
        return promise.then(function(channel) {
            return channel.open().then(function() {
                return channel;
            });
        });
    },

    // Get a channel that is identified with the given ID
    // The channel accepts no other parameters
    getChannel: function() {
        return this._getOpenedChannel(this._getChannelInternal(true, arguments));
    },

    // A named pipe is a PipeChannel with the given name
    // It can be useful to communicate between different apps, potentially
    // running on different tiers
    //
    // The returned channel will be a source if the second parameter is 'r',
    // and a sink if it is 'w'
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
