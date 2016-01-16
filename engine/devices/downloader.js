// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const fs = require('fs');
const path = require('path');
const lang = require('lang');
const Q = require('q');
const tmp = require('tmp');

const Thingpedia = require('./thingpedia');
const GenericDeviceFactory = require('./generic');

function safeMkdir(dir) {
    try {
        fs.mkdirSync(dir);
    } catch(e) {
        if (e.code !== 'EEXIST')
            throw e;
    }
}

module.exports = new lang.Class({
    Name: 'ModuleDownloader',

    _init: function() {
        this._cacheDir = platform.getCacheDir() + '/device-classes';

        this._deviceClassesDir = path.resolve(path.dirname(module.filename),
                                              '../device-classes');
        console.log('device class dir', this._deviceClassesDir);
        console.log('cache dir', this._cacheDir);
        this._cachedModules = {};
        this._moduleRequests = {};

        safeMkdir(this._cacheDir);
        safeMkdir(this._cacheDir + '/node_modules');
        try {
            platform.makeVirtualSymlink(path.resolve(path.dirname(module.filename),
                                                     '../node_modules/thingpedia'),
                                        this._cacheDir + '/node_modules/thingpedia');
        } catch(e) {
            if (e.code !== 'EEXIST')
                throw e;
        }
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
            this._cachedModules[fullId] = require('../device-classes/' + fullId);
            console.log('Module ' + fullId + ' loaded as builtin');
            return this._cachedModules[fullId];
        } catch(e) {
            return null;
        }
    },

    _createModuleFromBuiltinCode: function(fullId, id) {
        try {
            var fullPath = path.resolve(path.dirname(module.filename),
                                        '../device-classes/' + id + '.json');
            var code = fs.readFileSync(fullPath).toString('utf8');

            console.log('Module ' + fullId + ' loaded as builtin code');
            this._cachedModules[id] = GenericDeviceFactory(id, code);
            if (fullId === id)
                return this._cachedModules[id];
            else
                return this._cachedModules[id].getSubmodule(fullId.substr(id.length + 1));
        } catch(e) {
            if (e.code != 'ENOENT')
                throw e;
            return null;
        }
    },

    _createModuleFromCache: function(fullId) {
        try {
            var module = path.resolve(process.cwd(), this._cacheDir + '/' + fullId);
            this._cachedModules[fullId] = require(module);
            console.log('Module ' + fullId + ' loaded as cached');
            return this._cachedModules[fullId];
        } catch(e) {
            return null;
        }
    },

    _createModuleFromCachedCode: function(fullId, id) {
        try {
            var code = fs.readFileSync(this._cacheDir + '/' + id + '.json').toString('utf8');
            console.log('Module ' + fullId + ' loaded as cached code');
            this._cachedModules[id] = GenericDeviceFactory(id, code);
            if (fullId === id)
                return this._cachedModules[id];
            else
                return this._cachedModules[id].getSubmodule(fullId.substr(id.length + 1));
        } catch(e) {
            if (e.code != 'ENOENT')
                throw e;
            return null;
        }
    },

    _getModuleRequest: function(fullId, id) {
        if (id in this._moduleRequests)
            return this._moduleRequests[id];

        var codeTmpPath = this._cacheDir + '/' + id + '.json.tmp';
        var codePath = this._cacheDir + '/' + id + '.json';

        return this._moduleRequests[id] = Thingpedia.getCode(id).then(function(response) {
            var stream = fs.createWriteStream(codeTmpPath, { flags: 'wx', mode: 0600 });

            return Q.Promise(function(callback, errback) {
                response.pipe(stream);
                stream.on('finish', callback);
                stream.on('error', errback);
            });
        }.bind(this)).then(function() {
            fs.renameSync(codeTmpPath, codePath);

            return this._createModuleFromCachedCode(fullId, id);
        }.bind(this)).catch(function(e) {
            return Thingpedia.getZip(id).then(function(response) {
                return Q.nfcall(tmp.file, { mode: 0600,
                                            keep: true,
                                            dir: platform.getTmpDir(),
                                            prefix: 'thingengine-' + id + '-',
                                            postfix: '.zip' })
                    .then(function(result) {
                        var stream = fs.createWriteStream('', { fd: result[1], flags: 'w' });

                        return Q.Promise(function(callback, errback) {
                            response.pipe(stream);
                            stream.on('finish', function() {
                                callback(result[0]);
                            });
                            stream.on('error', errback);
                        });
                    });
            }.bind(this)).then(function(zipPath) {
                var dir = this._cacheDir + '/' + id;
                try {
                    fs.mkdirSync(dir);
                } catch(e) {
                    if (e.code != 'EEXIST')
                        throw e;
                }

                var unzip = platform.getCapability('code-download');
                return unzip.unzip(zipPath, dir).then(function() {
                    fs.unlinkSync(zipPath);
                });
            }.bind(this)).then(function() {
                return this._createModuleFromCache(fullId);
            }.bind(this));
        }.bind(this));
    },

    _createModule: function(fullId, id) {
        console.log('Loading device module ' + fullId);

        var module = this._createModuleFromBuiltinCode(fullId, id);
        if (module)
            return Q(module);
        module = this._createModuleFromBuiltin(fullId);
        if (module)
            return Q(module);
        module = this._createModuleFromCachedCode(fullId, id);
        if (module)
            return Q(module);
        module = this._createModuleFromCache(fullId);
        if (module)
            return Q(module);
        if (!platform.hasCapability('code-download'))
            throw new Error('Code download is not allowed on this platform');

        return this._getModuleRequest(fullId, id);
    },
});
