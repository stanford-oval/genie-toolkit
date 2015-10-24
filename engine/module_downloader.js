// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Config = require('./config');

const child_process = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const lang = require('lang');
const Q = require('q');

const GenericDeviceFactory = require('./generic_device');

var _agent = null;
function getAgent() {
    if (_agent === null) {
        var caFile = path.join(path.dirname(module.filename), './data/thingpedia.cert');
        _agent = new https.Agent({ keepAlive: false,
                                   maxSockets: 10,
                                   ca: fs.readFileSync(caFile) });
    }

    return _agent;
}

module.exports = new lang.Class({
    Name: 'ModuleDownloader',

    _init: function(kind) {
        this._kind = kind;
        this._url = Config.THINGPEDIA_URL + '/download/' + kind;
        this._cacheDir = platform.getCacheDir() + '/' + kind;

        this._cachedModules = {};
        this._moduleRequests = {};
    },

    _getModuleFull: function(id, subId) {
        var fullId;
        if (subId)
            fullId = id + '/' + subId;
        else
            fullId = id;

        if (fullId in this._cachedModules)
            return Q(this._cachedModules[fullId]);
        else if (id in this._cachedModules && this._cachedModules[id].getSubmodule)
            return Q(this._cachedModules[id].getSubmodule(subId));
        else
            return this._createModule(fullId, id);
    },

    getModule: function(id) {
        return this._getModuleFull(id);
    },

    getSubmodule: function(id, subId) {
        return this._getModuleFull(id, subId);
    },

    _createModuleFromBuiltin: function(fullId) {
        try {
            this._cachedModules[fullId] = require('./' + this._kind + '/' + fullId);
            console.log(this._kind + ' module ' + fullId + ' loaded as builtin');
            return this._cachedModules[fullId];
        } catch(e) {
            return null;
        }
    },

    _createModuleFromBuiltinCode: function(fullId, id) {
        if (this._kind !== 'devices')
            return null;
        try {
            var fullPath = path.join(path.dirname(module.filename),
                                     './' + this._kind + '/' + id + '.dlg');
            var code = fs.readFileSync(fullPath).toString('utf8');
            console.log(this._kind + ' module ' + fullId + ' loaded as builtin code');
            this._cachedModules[id] = GenericDeviceFactory(id, code);
            if (fullId === id)
                return this._cachedModules[id];
            else
                return this._cachedModules[id].getSubmodule(fullId.substr(id.length + 1));
        } catch(e) {
            console.log('Foo ' + e);
            console.log(e.stack);
            return null;
        }
    },

    _createModuleFromCache: function(fullId) {
        try {
            this._cachedModules[fullId] = require(this._cacheDir + '/' + fullId);
            console.log(this._kind + ' module ' + fullId + ' loaded as cached');
            return this._cachedModules[fullId];
        } catch(e) {
            return null;
        }
    },

    _createModuleFromCachedCode: function(fullId, id) {
        if (this._kind !== 'devices')
            return null;
        try {
            var code = fs.readFileSync(this._cacheDir + '/' + id + '.dlg').toString('utf8');
            console.log(this._kind + ' module ' + fullId + ' loaded as cached code');
            this._cachedModules[id] = GenericDeviceFactory(id, code);
            if (fullId === id)
                return this._cachedModules[id];
            else
                return this._cachedModules[id].getSubmodule(fullId.substr(id.length + 1));
        } catch(e) {
            return null;
        }
    },

    _getModuleRequest: function(fullId, id) {
        if (id in this._moduleRequests)
            return this._moduleRequests[id];

        var zipPath = platform.getTmpDir() + '/' + id + '.zip';
        var codeTmpPath = this._cacheDir + '/' + id + '.dlg.tmp';
        var codePath = this._cacheDir + '/' + id + '.dlg';

        return this._moduleRequests[id] = Q.Promise(function(callback, errback) {
            if (this._kind !== 'devices')
                throw new Error('Cannot use generic code for non-devices');

            var parsed = url.parse(this._url + '/code/' + id);
            parsed.agent = getAgent();
            https.get(parsed, function(response) {
                if (response.statusCode == 404)
                    throw new Error('No such ' + this._kind);
                if (response.statusCode != 200)
                    throw new Error('Unexpected HTTP error ' + response.statusCode + ' downloading channel ' + id);

                var stream = fs.createWriteStream(codeTmpPath, { flags: 'wx', mode: 0600 });

                response.pipe(stream);
                response.on('end', function() {
                    callback();
                });
            }.bind(this)).on('error', function(error) {
                errback(error);
            });
        }.bind(this)).then(function() {
            fs.renameSync(codeTmpPath, codePath);

            return this._createModuleFromCachedCode(id);
        }).catch(function(e) {
            return Q.Promise(function(callback, errback) {
                var parsed = url.parse(this._url + '/' + id + '.zip');
                parsed.agent = getAgent();
                https.get(parsed, function(response) {
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
                return Q.nfcall(child_process.execFile, 'unzip', [zipPath, this._cacheDir + '/' + id]);
            }.bind(this)).then(function() {
                return this._createModuleFromCache(fullId);
            });
        }.bind(this));
    },

    _createModule: function(fullId, id) {
        console.log('Loading ' + this._kind + ' module ' + fullId);

        var module = this._createModuleFromBuiltin(fullId);
        if (module)
            return Q(module);
        module = this._createModuleFromBuiltinCode(fullId, id);
        if (module)
            return Q(module);
        module = this._createModuleFromCache(fullId);
        if (module)
            return Q(module);
        module = this._createModuleFromCachedCode(fullId, id);
        if (module)
            return Q(module);
        if (!platform.hasCapability('code-download'))
            throw new Error('Code download is not allowed on this platform');

        try {
            fs.mkdirSync(this._cacheDir);
        } catch(e) {
            if (e.code != 'EEXIST')
                throw e;
        }

        return this._getModuleRequest(fullId, id);
    },
});
