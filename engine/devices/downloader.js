// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Config = require('../config');

const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const lang = require('lang');
const Q = require('q');
const tmp = require('tmp');

const GenericDeviceFactory = require('./generic');

var _agent = null;
function getAgent() {
    if (_agent === null) {
        var caFile = path.resolve(path.dirname(module.filename), '../data/thingpedia.cert');
        _agent = new https.Agent({ keepAlive: false,
                                   maxSockets: 10,
                                   ca: fs.readFileSync(caFile) });
    }

    return _agent;
}

module.exports = new lang.Class({
    Name: 'ModuleDownloader',

    _init: function() {
        this._zipUrl = Config.THINGPEDIA_URL + '/download/devices';
        this._codeUrl = Config.THINGPEDIA_URL + '/api/code/devices';
        this._cacheDir = platform.getCacheDir() + '/device-classes';

        this._deviceClassesDir = path.resolve(path.dirname(module.filename),
                                              '../device-classes');
        console.log('device class dir', this._deviceClassesDir);
        console.log('cache dir', this._cacheDir);
        this._cachedModules = {};
        this._moduleRequests = {};

        try {
            fs.mkdirSync(this._cacheDir);
        } catch(e) {
            if (e.code !== 'EEXIST')
                throw e;
        }
        try {
            platform.makeVirtualSymlink(require.resolve('../base_device'),
                                        this._cacheDir + '/base_device.js');
            platform.makeVirtualSymlink(require.resolve('../base_channel'),
                                        this._cacheDir + '/base_channel.js');
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

        return this._moduleRequests[id] = Q.Promise(function(callback, errback) {
            var parsed = url.parse(this._codeUrl + '/' + id);
            parsed.agent = getAgent();
            https.get(parsed, function(response) {
                if (response.statusCode == 404)
                    return errback(new Error('No such device code ' + id));
                if (response.statusCode != 200)
                    return errback(new Error('Unexpected HTTP error ' + response.statusCode + ' downloading channel ' + id));

                var stream = fs.createWriteStream(codeTmpPath, { flags: 'wx', mode: 0600 });

                response.pipe(stream);
                stream.on('finish', function() {
                    callback();
                });
                stream.on('error', function(error) {
                    errback(error);
                });
            }.bind(this)).on('error', function(error) {
                errback(error);
            });
        }.bind(this)).then(function() {
            fs.renameSync(codeTmpPath, codePath);

            return this._createModuleFromCachedCode(fullId, id);
        }.bind(this)).catch(function(e) {
            return Q.Promise(function(callback, errback) {
                var parsed = url.parse(this._zipUrl + '/' + id + '.zip');
                parsed.agent = getAgent();
                https.get(parsed, function(response) {
                    if (response.statusCode == 404)
                        return errback(new Error('No such device ' + id));
                    if (response.statusCode != 200)
                        return errback(new Error('Unexpected HTTP error ' + response.statusCode + ' downloading channel ' + id));

                    return Q.nfcall(tmp.file, { mode: 0600,
                                                keep: true,
                                                dir: platform.getTmpDir(),
                                                prefix: 'thingengine-' + id + '-',
                                                postfix: '.zip' })
                        .then(function(result) {
                            var stream = fs.createWriteStream('', { fd: result[1], flags: 'w' });

                            response.pipe(stream);
                            stream.on('finish', function() {
                                callback(result[0]);
                            });
                            stream.on('error', function(error) {
                                errback(error);
                            });
                        });
                }.bind(this)).on('error', function(error) {
                    errback(error);
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
