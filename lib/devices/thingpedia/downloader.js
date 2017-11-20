// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const fs = require('fs');
const path = require('path');
const Q = require('q');
const tmp = require('tmp');
const Module = require('module');
const Tp = require('thingpedia');

const GenericRestModule = require('./generic');
const RSSModule = require('./rss_factory');

const Builtins = require('./builtins');

function safeMkdir(dir) {
    try {
        fs.mkdirSync(dir);
    } catch(e) {
        if (e.code !== 'EEXIST')
            throw e;
    }
}

function resolve(mainModule)
{
    if (!mainModule.startsWith('/'))
        throw new Error('Invalid relative module path');
    if (require.resolve)
        return require.resolve(mainModule);
    else
        return Module._resolveFilename(mainModule, module, false);
}

function clearRequireCache(mainModule) {
    try {
        var fileName = resolve(mainModule);
        console.log(mainModule + ' was cached as ' + fileName);

        delete require.cache[fileName];

        var prefix = path.dirname(fileName) + '/';
        for (var key in require.cache) {
            if (key.startsWith(prefix))
                delete require.cache[key];
        }
    } catch(e) {}
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

class CustomModule {
    constructor(platform, client, id, manifest) {
        this._client = client;
        this._platform = platform;
        this._cacheDir = platform.getCacheDir() + '/device-classes';
        this._id = id;
        this._manifest = manifest;

        this._loading = null;
        this._modulePath = null;
    }

    get id() {
        return this._id;
    }
    get manifest() {
        return this._manifest;
    }
    get version() {
        return this._manifest.version;
    }

    clearCache() {
        this._loading = null;

        if (this._modulePath)
            clearRequireCache(this._modulePath);
    }

    _loadJsModule(id) {
        var modulePath = this._modulePath;
        var version = JSON.parse(fs.readFileSync(modulePath + '/package.json').toString('utf8'))['thingpedia-version'];
        if (version !== this._manifest.version) {
            console.log('Cached module ' + this.id + ' is out of date');
            return null;
        }

        var module = require(modulePath);
        module.require = function(subpath) {
            return require(path.resolve(modulePath, subpath));
        };
        module.metadata = this._manifest;
        if (module.runOAuth2 && module.runOAuth2.install)
            module.runOAuth2.install(module.prototype);

        return module;
    }

    getDeviceFactory() {
        if (this._loading)
            return this._loading;

        this._modulePath = path.resolve(process.cwd(), this._cacheDir + '/' + this._id);

        if (fs.existsSync(this._modulePath)) {
            var cached = this._loadJsModule();
            if (cached)
                return this._loading = cached;
        }

        return this._loading = this._client.getModuleLocation(this._id, this._manifest.version).then((redirect) => {
            return Tp.Helpers.Http.getStream(redirect);
        }).then((response) => {
            return Q.nfcall(tmp.file, { mode: 0o600,
                                        keep: true,
                                        dir: this._platform.getTmpDir(),
                                        prefix: 'thingengine-' + this._id + '-',
                                        postfix: '.zip' })
                .then((result) => {
                    var stream = fs.createWriteStream('', { fd: result[1], flags: 'w' });

                    return Q.Promise((callback, errback) => {
                        response.pipe(stream);
                        stream.on('finish', function() {
                            callback(result[0]);
                        });
                        stream.on('error', errback);
                    });
                });
        }).then((zipPath) => {
            try {
                fs.mkdirSync(this._modulePath);
            } catch(e) {
                if (e.code != 'EEXIST')
                    throw e;
            }

            var unzip = this._platform.getCapability('code-download');
            return unzip.unzip(zipPath, this._modulePath).then(() => {
                fs.unlinkSync(zipPath);
            });
        }).then(() => {
            return this._loadJsModule();
        }).catch((e) => {
            this._loading = null;
            throw e;
        });
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
                if (e.code != 'ENOENT')
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

                return Q.Promise(function(callback, errback) {
                    stream.write(JSON.stringify(manifest));
                    stream.end();
                    stream.on('finish', callback);
                    stream.on('error', errback);
                }).then(function() {
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

            switch (manifest.module_type) {
            case 'org.thingpedia.builtin':
                return new BuiltinModule(id, manifest);
            case 'org.thingpedia.v1':
                return new CustomModule(this._platform, this._client, id, manifest);
            case 'org.thingpedia.rss':
                return new RSSModule(id, manifest);
            case 'org.thingpedia.generic_rest.v1':
                return new GenericRestModule(id, manifest);
            default:
                // FINISHME the other module types...
                throw new Error('Unsupported module type ' + manifest.module_type);
            }
        });
    }
}
