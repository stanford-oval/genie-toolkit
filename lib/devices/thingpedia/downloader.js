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
const Tp = require('thingpedia');

const GenericDeviceFactory = require('./generic');

function safeMkdir(dir) {
    try {
        fs.mkdirSync(dir);
    } catch(e) {
        if (e.code !== 'EEXIST')
            throw e;
    }
}

function clearRequireCache(mainModule) {
    try {
        var fileName = require.resolve(mainModule);
        console.log(mainModule + ' was cached as ' + fileName);

        delete require.cache[fileName];

        var prefix = path.dirname(fileName) + '/';
        for (var key in require.cache) {
            if (key.startsWith(prefix))
                delete require.cache[key];
        }
    } catch(e) {}
}

module.exports = class ModuleDownloader {
    constructor(platform, client) {
        this._platform = platform;
        this._client = client;
        this._cacheDir = platform.getCacheDir() + '/device-classes';
        this._cachedModules = {};
        this._moduleRequests = {};

        safeMkdir(this._cacheDir);
        safeMkdir(this._cacheDir + '/node_modules');
        try {
            platform.makeVirtualSymlink(path.dirname(require.resolve('thingpedia')),
                                        this._cacheDir + '/node_modules/thingpedia');
        } catch(e) {
            if (e.code !== 'EEXIST')
                throw e;
        }
    }

    getCachedMetas() {
        return Q.nfcall(fs.readdir, this._cacheDir).then(function(files) {
            return Q.all(files.map(function(name) {
                return Q.try(function() {
                    if (name === 'node_modules')
                        return null;
                    var file = path.resolve(this._cacheDir, name);
                    if (name.endsWith('.json')) {
                        return Q.nfcall(fs.readFile, file).then(function(buffer) {
                            var json = JSON.parse(buffer.toString());

                            return ({ name: name.substr(0, name.length-5),
                                      version: json.version,
                                      generic: true });
                        });
                    } else {
                        return Q.nfcall(fs.readFile, path.resolve(file, 'package.json')).then(function(buffer) {
                            var json = JSON.parse(buffer.toString());

                            return ({ name: name,
                                      version: json['thingpedia-version'],
                                      generic: false });
                        });
                    }
                }.bind(this)).catch(function(e) {
                    return ({ name: name,
                              version: 'Error: ' + e.message,
                              generic: false });
                });
            }, this));
        }.bind(this)).then(function(objs) {
            return objs.filter(function(o) { return o !== null; });
        });
    }

    updateModule(id) {
        delete this._moduleRequests[id];
        clearRequireCache(this._cacheDir + '/' + id);
        return this._getModuleRequest(id, id).then(function(module) {
            if (!module.isGeneric) {
                var prefix = id + '/';
                for (var key in this._cachedModules) {
                    if (key.startsWith(prefix))
                        delete this._cachedModules[key];
                }
            }
        }.bind(this));
    }

    getModule(id) {
        if (id in this._cachedModules)
            return Q(this._cachedModules[id]);
        else
            return this._createModule(id);
    }

    _loadJsModule(modulePath) {
        var module = require(modulePath);
        module.isGeneric = false;
        module.require = function(subpath) {
            return require(path.resolve(modulePath, subpath));
        };
        try {
            var packageJson = require(modulePath + '/package.json');
        } catch(e) {
            return module;
        }
        module.version = packageJson['thingpedia-version'];
        if (packageJson['thingpedia-metadata']) {
            module.metadata = packageJson['thingpedia-metadata'];
        } else {
            module.metadata = {
                params: {},
                types: []
            };
        }
        return module;
    }

    _createModuleFromBuiltin(id) {
        var builtinId;
        if (id.startsWith('org.thingpedia.builtin.'))
            builtinId = id.substr('org.thingpedia.builtin.'.length);
        else
            builtinId = id; // we should reject it right away but we keep it for compat

        try {
            var modulePath = path.dirname(require.resolve('./builtins/' + builtinId))
            this._cachedModules[id] = this._loadJsModule(modulePath);
            console.log('Module ' + id + ' loaded as builtin');
            return this._cachedModules[id];
        } catch(e) {
            if (id.startsWith('org.thingpedia.builtin.'))
                // if we know it's a builtin we're not going to eat the error
                throw e;
            return null;
        }
    }

    _createModuleFromCache(id, silent) {
        try {
            var modulePath = path.resolve(process.cwd(), this._cacheDir + '/' + id);
            this._cachedModules[id] = this._loadJsModule(modulePath);
            console.log('Module ' + id + ' loaded as cached');
            return this._cachedModules[id];
        } catch(e) {
            if (!silent)
                throw e;
            return null;
        }
    }

    _createModuleFromCachedCode(id) {
        var code;
        try {
            code = fs.readFileSync(this._cacheDir + '/' + id + '.json').toString('utf8');
        } catch(e) {
            if (e.code != 'ENOENT')
                throw e;
            return null;
        }

        console.log('Module ' + id + ' loaded as cached code');
        this._cachedModules[id] = GenericDeviceFactory(id, code);
        this._cachedModules[id].isGeneric = true;
        return this._cachedModules[id];
    }

    _ensureModuleRequest(id) {
        if (id in this._moduleRequests)
            return;

        var codeTmpPath = this._cacheDir + '/' + id + '.json.tmp';
        var codePath = this._cacheDir + '/' + id + '.json';

        this._moduleRequests[id] = this._client.getDeviceCode(id).then(function(codeObj) {
            var stream = fs.createWriteStream(codeTmpPath, { flags: 'wx', mode: 0o600 });

            return Q.Promise(function(callback, errback) {
                stream.write(JSON.stringify(codeObj));
                stream.end();
                stream.on('finish', callback);
                stream.on('error', errback);
            });
        }.bind(this)).then(function() {
            fs.renameSync(codeTmpPath, codePath);
            return 'code';
        }.bind(this)).catch(function(e) {
            console.log('Failed to load as code, trying as zip file');
            return this._client.getModuleLocation(id).then(function(redirect) {
                console.log('module ' + id + ' lives at ' + redirect);
                return Tp.Helpers.Http.getStream(redirect);
            }.bind(this)).then(function(response) {
                return Q.nfcall(tmp.file, { mode: 0o600,
                                            keep: true,
                                            dir: this._platform.getTmpDir(),
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

                var unzip = this._platform.getCapability('code-download');
                return unzip.unzip(zipPath, dir).then(function() {
                    fs.unlinkSync(zipPath);
                });
            }.bind(this)).then(function() {
                return 'zip';
            });
        }.bind(this));
    }

    _getModuleRequest(id) {
        console.log('_getModuleRequest ' + id);
        this._ensureModuleRequest(id);

        return this._moduleRequests[id].then(function(how) {
            if (how === 'code')
                return this._createModuleFromCachedCode(id);
            else
                return this._createModuleFromCache(id, false);
        }.bind(this));
    }

    _createModule(id) {
        console.log('Loading device module ' + id);

        module = this._createModuleFromBuiltin(id);
        if (module)
            return Q(module);
        module = this._createModuleFromCachedCode(id);
        if (module)
            return Q(module);
        module = this._createModuleFromCache(id, true);
        if (module)
            return Q(module);
        if (!this._platform.hasCapability('code-download'))
            return Q.reject(new Error('Code download is not allowed on this platform'));

        return this._getModuleRequest(id);
    }
}
