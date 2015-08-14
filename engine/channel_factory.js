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

module.exports = new lang.Class({
    Name: 'ChannelFactory',

    _init: function(engine) {
        this._engine = engine;
        this._channelMetas = {};
        this._cachedChannels = {};

        this._downloader = new ModuleDownloader('channels');
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

    _createChannelInternal: function(id) {
        var args = Array.prototype.slice.call(arguments, 0);

        var fullId = args.map(function(arg) {
            if (typeof arg === 'string')
                return arg;
            else if (arg.uniqueId !== undefined)
                return arg.uniqueId;
            else
                return arg;
        }).join('-');
        if (fullId in this._cachedChannels)
            return Q(this._cachedChannels[fullId]);

        return this._downloader.getModule(id).then(function(factory) {
            var channel = factory.createChannel.apply(factory, [this._engine].concat(args));
            channel.uniqueId = fullId;

            if (!channel.isSupported) // uh oh, need a ProxyChannel instead!
                throw new Error('ProxyChannel not yet implemented...');

            return this._cachedChannels[fullId] = channel;
        }.bind(this)).catch(function(e) {
            // channel download or creation failed!
            // try with a proxychannel
            throw new Error('ProxyChannel not yet implemented...');
        });
    },

    createChannel: function(id) {
        return this._createChannelInternal(id).then(function(channel) {
            return this._cachedChannels[id] = channel;
        });
    },

    createDeviceChannel: function(id, device) {
        return this._createChannelInternal(id, device);
    }
});
