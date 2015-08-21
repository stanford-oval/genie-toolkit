// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Config = require('./config');

const child_process = require('child_process');
const http = require('http');
const https = require('https');
const fs = require('fs');
const lang = require('lang');
const Q = require('q');

module.exports = new lang.Class({
    Name: 'ModuleDownloader',

    _init: function(kind) {
        this._kind = kind;
        this._url = Config.THINGPEDIA_URL + '/' + kind;
        this._cacheDir = platform.getCacheDir() + '/' + kind;

        this._cachedModules = {};
        this._moduleRequests = {};
    },

    _createModuleFromBuiltin: function(id) {
        try {
            this._cachedModules[id] = require('./' + this._kind + '/' + id);
            console.log(this._kind + ' module ' + id + ' loaded as builtin');
            return this._cachedModules[id];
        } catch(e) {
            console.log('Foo ' + e);
            return null;
        }
    },

    _createModuleFromCache: function(id) {
        try {
            this._cachedModules[id] = require(this._cacheDir + '/' + id);
            console.log(this._kind + ' module ' + id + ' loaded as cached');
            return this._cachedModules[id];
        } catch(e) {
            return null;
        }
    },

    _getModuleRequest: function(id) {
        if (id in this._moduleRequests)
            return this._moduleRequests[id];

        return this._moduleRequests[id] = Q.Promise(function(callback, errback) {
            http.get(this._url + '/' + id + '.zip', function(response) {
                if (response.statusCode == 404)
                    throw new Error('No such ' + this._kind);
                if (response.statusCode != 200)
                    throw new Error('Unexpected HTTP error ' + response.statusCode + ' downloading channel ' + id);

                var stream = fs.createWriteStream(zipPath, { flags: 'wx', mode: 0600 });

                response.pipe(stream);
                response.on('end', function() {
                    callback();
                });
            }.bind(this)).on('error', function(error) {
                errback(error);
            });
        }.bind(this)).then(function() {
            return Q.nfcall(child_process.execFile, 'unzip', [zipPath, this._cachePath + '/' + id]);
        }.bind(this));
    },

    _createModule: function(id) {
        console.log('Loading ' + this._kind + ' module ' + id);

        var module = this._createModuleFromBuiltin(id);
        if (module)
            return Q(module);
        module = this._createModuleFromCache(id);
        if (module)
            return Q(module);
        if (!platform.canDownloadCode)
            throw new Error('Code download is not allowed on this platform');

        var cachePath = platform.getCacheDir() + '/channels/';
        var zipPath = platform.getTmpDir() + '/' + id + '.zip';

        try {
            fs.mkdirSync(cachePath);
        } catch(e) {
            if (e.code != 'EEXIST')
                throw e;
        }

        return this._getModuleRequest(id).then(function() {
            return this._createModuleFromCache(id);
        }.bind(this));
    },

    getModule: function(id) {
        if (id in this._cachedModules)
            return Q(this._cachedModules[id]);
        else
            return this._createModule(id);
    }
});
