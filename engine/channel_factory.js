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

const ModuleDownloader = require('./module_downloader');
const ProxyManager = require('./proxy');
const PipeManager = require('./pipes');
const Tier = require('./tier_manager').Tier;

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
    },

    start: function() {
        return Q();
    },

    stop: function() {
        return Q();
    },

    _getProxyChannel: function(forChannel, kind, args) {
        // FINISHME!! Be smarter in choosing where to run this channel
        // (and factor CLOUD in the decision)

        var targetTier;
        if (this._tierManager.ownTier == Tier.PHONE)
            targetTier = Tier.SERVER;
        else
            targetTier = Tier.PHONE;

        return this._proxyManager.getProxyChannel(forChannel, targetTier, [kind].concat(args));
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

        return this._cachedChannels[fullId] = this._downloader.getModule(kind).then(function(factory) {
            var channel = factory.createChannel.apply(factory, [this._engine].concat(args));
            channel.uniqueId = fullId;

            if (!channel.isSupported) {
                // uh oh! channel does not work, try with a proxy channel
                if (useProxy) {
                    return this._getProxyChannel(channel, kind, args);
                } else {
                    throw new Error('Channel is not supported but proxy channel is not allowed');
                }
            }

            return channel;
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
