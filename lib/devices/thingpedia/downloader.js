// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const fs = require('fs');
const path = require('path');
const Q = require('q');
const Tp = require('thingpedia');

const Builtins = require('./builtins');

function safeMkdir(dir) {
    try {
        fs.mkdirSync(dir);
    } catch(e) {
        if (e.code !== 'EEXIST')
            throw e;
    }
}

class BuiltinModule {
    constructor(id, manifest) {
        this._id = id;
        this._manifest = manifest;

        this._loaded = null;
    }

    get id() {
        return this._id;
    }
    get manifest() {
        return this._manifest;
    }
    get version() {
        return 0; // version does not matter for builtin
    }

    clearCache() {
        // nothing to do here
    }

    getDeviceFactory() {
        if (this._loaded)
            return this._loaded;

        var builtinId = this._id.substr('org.thingpedia.builtin.'.length);
        this._loaded = Builtins[builtinId];
        this._loaded.metadata = this._manifest;
        return this._loaded;
    }
}

module.exports = class ModuleDownloader {
    constructor(platform, client) {
        this._platform = platform;
        this._client = client;
        this._cacheDir = platform.getCacheDir() + '/device-classes';
        this._moduleRequests = {};

        safeMkdir(this._cacheDir);
        safeMkdir(this._cacheDir + '/node_modules');

        if (platform.type !== 'android') {
            try {
                fs.symlinkSync(path.dirname(require.resolve('thingpedia')),
                               this._cacheDir + '/node_modules/thingpedia');
            } catch(e) {
                if (e.code !== 'EEXIST')
                    throw e;
            }
            try {
                fs.symlinkSync(path.dirname(require.resolve('thingtalk')),
                               this._cacheDir + '/node_modules/thingtalk');
            } catch(e) {
                if (e.code !== 'EEXIST')
                    throw e;
            }
        }
    }

    getCachedMetas() {
        return Q.nfcall(fs.readdir, this._cacheDir).then((files) => {
            return Q.all(files.map((name) => {
                return Q.try(() => {
                    if (name === 'node_modules')
                        return null;
                    var file = path.resolve(this._cacheDir, name);
                    if (name.endsWith('.manifest.json')) {
                        return Q.nfcall(fs.readFile, file).then(function(buffer) {
                            var json = JSON.parse(buffer.toString());

                            return ({ name: name.substr(0, name.length-('.manifest.json'.length)),
                                      version: json.version });
                        });
                    } else {
                        return null;
                    }
                }).catch((e) => {
                    return ({ name: name,
                              version: 'Error: ' + e.message });
                });
            }, this));
        }).then((objs) => {
            return objs.filter(function(o) { return o !== null; });
        });
    }

    updateModule(id) {
        return Q.try(() => {
            if (!this._moduleRequests[id])
                return null;

            return this._moduleRequests[id].catch((e) => {
                // ignore errors
                return null;
            });
        }).then((module) => {
            delete this._moduleRequests[id];
            return module;
        }).then((module) => {
            if (!module)
                return;

            return module.clearCache();
        }).then(() => {
            return this._loadManifest(id, false);
        });
    }

    getModule(id) {
        this._ensureModuleRequest(id);
        return this._moduleRequests[id];
    }

    _loadManifest(id, canUseCache) {
        if (!this._platform.hasCapability('code-download'))
            return Q.reject(new Error('Code download is not allowed on this platform'));

        var manifestTmpPath = this._cacheDir + '/' + id + '.manifest.json.tmp';
        var manifestPath = this._cacheDir + '/' + id + '.manifest.json';

        return Q.try(() => {
            if (!canUseCache)
                return false;
            return Q.nfcall(fs.stat, manifestPath).then((stat) => {
                var now = new Date;
                if (now.getTime() - stat.mtime.getTime() > 7 * 24 * 3600 * 1000)
                    return false;
                else
                    return true;
            }).catch((e) => {
                if (e.code !== 'ENOENT')
                    throw e;
                return false;
            });
        }).then((useCached) => {
            if (!useCached)
                return null;
            return Q.nfcall(fs.readFile, manifestPath);
        }).then((manifestBuffer) => {
            if (manifestBuffer !== null)
                return JSON.parse(manifestBuffer.toString('utf8'));

            return this._client.getDeviceCode(id, 2).then((manifest) => {
                var stream = fs.createWriteStream(manifestTmpPath, { flags: 'w', mode: 0o600 });

                return Q.Promise((callback, errback) => {
                    stream.write(JSON.stringify(manifest));
                    stream.end();
                    stream.on('finish', callback);
                    stream.on('error', errback);
                }).then(() => {
                    fs.renameSync(manifestTmpPath, manifestPath);
                    return manifest;
                });
            });
        });
    }

    _ensureModuleRequest(id) {
        if (id in this._moduleRequests)
            return;

        this._moduleRequests[id] = this._loadManifest(id, true).then((manifest) => {
            console.log('Loaded manifest for ' + id + ', module type: '+ manifest.module_type + ', version: ' + manifest.version);

            manifest.kind = id;
            manifest.auth = manifest.auth || {};

            if (id.startsWith('org.thingpedia.builtin.') && manifest.module_type !== 'org.thingpedia.builtin') {
                console.error('DATABASE ERROR: ' + id + ' is not marked as a builtin');
                manifest.module_type = 'org.thingpedia.builtin';
            }

            if (manifest.module_type === 'org.thingpedia.builtin')
                return new BuiltinModule(id, manifest);

            return new (Tp.Modules[manifest.module_type])(id, manifest, this._platform, this._client);
        });
    }
};
