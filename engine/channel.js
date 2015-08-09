// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const child_process = require('child_process');
const http = require('http');
const https = require('https');
const fs = require('fs');
const lang = require('lang');
const Q = require('q');

const Channel = new lang.Class({
    Name: 'Channel',
    Abstract: true,

    _init: function(id) {
        this._id = id;
    },

    get id() {
        return this._id;
    },

    createTrigger: function(name, params) {
        throw new Error('Invalid trigger');
    },

    createAction: function(name, params) {
        throw new Error('Invalid action');
    },
});

const ChannelFactory = new lang.Class({
    Name: 'ChannelFactory',

    _init: function() {
        this._channelMetas = {};
        this._cachedFactories = {};
    },

    load: function() {
        return Q.Promise(function(callback, errback) {
            var buffer = '';
            http.get('http://thingpedia.stanford.edu/db/channels.json', function(response) {
                if (response.statusCode != 200) {
                    errback(new Error('Unexpected HTTP error ' + response.statusCode + ' reading channel DB'));
                    return;
                }

                response.setEncoding('utf8');
                response.on('data', function(chunk) {
                    buffer += chunk;
                });
                response.on('end', function() {
                    callback(JSON.parse(buffer));
                });
            }).on('error', function(error) {
                errback(error);
            });
        }).then(function(channels) {
            for (var i = 0; i < channels.length; i++) {
                this._channelMetas[channels[i].id] = channels[i];
            }
        }.bind(this));
    },

    createChannel: function(id) {
        if (id in this._cachedFactories)
            return this._cachedFactories.createChannel(id);

        if (id in this._channelMetas) {
            return this._createFactory(this._channelMetas[id]).then(function(factory) {
                return factory.createChannel(id);
            });
        }

        throw new Error('Invalid channel id ' + id);
    },

    _createFactoryFromCache: function(id) {
        var cache = platform.getWritableDir() + '/channel_cache/';

        try {
            return require(cache + id);
        } catch(e) {
            return null;
        }
    },

    _createFactory: function(id) {
        var module = this._createFactoryFromCache(id);
        if (module)
            return this._cachedFactories[id] = module;

        var cachePath = platform.getWritableDir() + '/channel_cache/';
        var zipPath = platform.getTmpDir() + '/' + id + '.zip';

        return Q.Promise(function(callback, errback) {
            http.get('http://thingpedia.stanford.edu/channels/' + id + '.zip', function(response) {
                if (response.statusCode != 200)
                    throw new Error('Unexpected HTTP error ' + response.statusCode + ' downloading channel ' + id);

                var stream = fs.createWriteStream(zipPath, { flags: 'wx', mode: 0600 });

                response.pipe(stream);
                response.on('end', function() {
                    callback();
                });
            }).on('error', function(error) {
                errback(error);
            });
        }).then(function() {
            return Q.nfcall(fs.mkdir, cachePath + id);
        }).then(function() {
            return Q.nfcall(child_process.execFile, 'unzip', [zipPath, cachePath + id]);
        }).then(function() {
            return this._createFactoryFromCache(id);
        }.bind(this));
    }
});

module.exports = {
    Channel: Channel,
    ChannelFactory: ChannelFactory
};
