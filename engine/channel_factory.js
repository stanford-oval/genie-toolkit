// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Config = require('./config');

const http = require(Config.THINGPEDIA_ACCESS_MODULE);
const fs = require('fs');
const lang = require('lang');
const Q = require('q');

const ModuleDownloader = require('./module_downloader');
const ProxyManager = require('./proxy');
const PipeManager = require('./pipes');
const Tier = require('./tier_manager').Tier;

module.exports = new lang.Class({
    Name: 'ChannelFactory',

    _init: function(engine, tiers) {
        this._engine = engine;
        this._channelMetas = {};
        this._cachedChannels = {};

        this._downloader = new ModuleDownloader('channels');
        this._tierManager = tiers;
        this._proxyManager = new ProxyManager(tiers, this, engine.devices);
        this._pipeManager = new PipeManager(tiers, this._proxyManager);
    },

    _loadFromData: function(data) {
        var channels = JSON.parse(data);
        for (var i = 0; i < channels.length; i++) {
            this._channelMetas[channels[i].id] = channels[i];
        }
    },

    _loadFromDisk: function() {
        var cacheFile = platform.getCacheDir() + '/channels.json';
        return Q.try(function() {
            var stats = fs.statSync(cacheFile);
            if ((new Date).getTime() - stats.mtime.getTime() > 2 * 24 * 3600 * 1000) { // two days
                fs.unlinkSync(cacheFile);
                var e = new Error('Too old');
                e.code = 'ENOENT';
                throw e;
            }
        }).then(function() {
            return Q.nfcall(fs.readFile, cacheFile);
        }).then(function(data) {
            this._loadFromData(data);
        }.bind(this));
    },

    _loadFromServer: function() {
        var cacheFile = platform.getCacheDir() + '/channels.json';
        return Q.Promise(function(callback, errback) {
            var buffer = '';
            http.get(Config.THINGPEDIA_URL + '/db/channels.json', function(response) {
                if (response.statusCode != 200) {
                    errback(new Error('Unexpected HTTP error ' + response.statusCode + ' reading channel DB'));
                    return;
                }

                response.setEncoding('utf8');
                response.on('data', function(chunk) {
                    buffer += chunk;
                });
                response.on('end', function() {
                    callback(buffer);
                });
            }).on('error', function(error) {
                errback(error);
            });
        }).then(function(data) {
            return Q.nfcall(fs.writeFile, cacheFile, data, { mode: 0600 })
                .then(function() {
                    return this._loadFromData(data);
                }.bind(this));
        }.bind(this));
    },

    load: function() {
        return this._loadFromDisk().catch(function(e) {
            if (e.code != 'ENOENT')
                throw e;

            return this._loadFromServer();
        }.bind(this));
    },

    // For compatibility with existing channels, should only be called
    // by the IFTTT code
    createIFTTTChannel: function(id) {
        if (id in this._cachedChannels)
            return this._cachedChannels[id];
        else
            throw new Error('Invalid channel id ' + id);
    },

    _getProxyChannel: function(forChannel, args) {
        // FINISHME!! Be smarter in choosing where to run this channel
        // (and factor CLOUD in the decision)

        var targetTier;
        if (this._tierManager.ownTier == Tier.PHONE)
            targetTier = Tier.SERVER;
        else
            targetTier = Tier.PHONE;

        return this._proxyManager.getProxyChannel(forChannel, targetTier, args);
    },

    _getChannelInternal: function(useProxy, id) {
        var args = Array.prototype.slice.call(arguments, 1);

        // Named pipes are special in that we need some coordination
        // to ensure that we always have all proxies across all the tiers
        // So ask our trusty pipe manager for it
        //
        // (Note: we only follow this path for a request from ProxyManager)
        if (id === 'pipe')
            return this._pipeManager.getProxyNamedPipe(args[1]);

        var fullId = args.map(function(arg) {
            if (typeof arg === 'string')
                return arg;
            else if (arg.uniqueId !== undefined)
                return arg.uniqueId;
            else
                return arg;
        }).join('-');

        if (fullId in this._cachedChannels)
            return this._cachedChannels[fullId];

        return this._cachedChannels[fullId] = this._downloader.getModule(id).then(function(factory) {
            var channel = factory.createChannel.apply(factory, [this._engine].concat(args));
            channel.uniqueId = fullId;

            if (!channel.isSupported || channel.allowedTiers.indexOf(this._tierManager.ownTier) < 0) {
                // uh oh! channel does not work, try with a proxy channel
                if (useProxy) {
                    return this._getProxyChannel(channel, args);
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

    getChannel: function(id) {
        return this._getOpenedChannel(this._getChannelInternal(true, id));
    },

    getDeviceChannel: function(id, device) {
        return this._getOpenedChannel(this._getChannelInternal(true, id, device));
    },

    // A named pipe is a PipeChannel with the given name
    // It can be useful to communicate between different apps, potentially
    // running on different tiers
    //
    // The returned channel will be a source if the second parameter is 'r',
    // and a sink it is 'w'
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
