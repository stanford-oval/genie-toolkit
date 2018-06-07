// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See LICENSE for details
"use strict";

const path = require('path');
const fs = require('fs');
const tmp = require('tmp');

const Module = require('module');

const Tp = require('thingpedia');

// shared code between v1 and v2 modules

function resolve(mainModule) {
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
    } catch(e) {
        // do nothing
    }
}


module.exports = class BaseJavascriptModule {
    constructor(id, manifest, platform, client, loader) {
        this._client = client;
        this._loader = loader;
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

    createSubmodule(id, manifest, deviceClass) {
        const submodule = new (this.constructor[Symbol.species])(id, manifest, this._platform, this._client);
        submodule._loading = deviceClass;
        submodule._completeLoading(deviceClass);

        return submodule;
    }

    _completeLoading(deviceClass) {
        deviceClass.metadata = this._manifest;

        if (deviceClass.runOAuth2 && deviceClass.runOAuth2.install)
            deviceClass.runOAuth2.install(deviceClass.prototype);
    }

    _loadJsModule(id) {
        var modulePath = this._modulePath;
        var version = JSON.parse(fs.readFileSync(modulePath + '/package.json').toString('utf8'))['thingpedia-version'];
        if (version !== this._manifest.version) {
            console.log('Cached module ' + this.id + ' is out of date');
            return null;
        }

        var deviceClass = require(modulePath);
        deviceClass.require = function(subpath) {
            return require(path.resolve(modulePath, subpath));
        };
        this._completeLoading(deviceClass);

        const subdevices = deviceClass.subdevices || {};
        return Promise.all((this.manifest.child_types || []).map((childId) => {
            if (!(childId in subdevices)) {
                console.error(`Child device ${childId} is not declared in ${deviceClass.name}.subdevices, this will cause unexpected behavior`);
                return Promise.resolve();
            }

            return this._loader.loadManifest(childId, true).then((childManifest) => {
                const submodule = this.createSubmodule(childId, childManifest, subdevices[childId]);
                this._loader.injectModule(childId, submodule);
            });
        })).then(() => {
            this._loading = deviceClass;
            return deviceClass;
        });
    }

    getDeviceFactory() {
        if (this._loading)
            return Promise.resolve(this._loading);

        this._modulePath = path.resolve(process.cwd(), this._cacheDir + '/' + this._id);

        if (fs.existsSync(this._modulePath)) {
            var cached = this._loadJsModule();
            if (cached)
                return Promise.resolve(this._loading = cached);
        }

        return this._loading = Promise.resolve(this._client.getModuleLocation(this._id, this._manifest.version))
        .then((redirect) => Tp.Helpers.Http.getStream(redirect))
        .then((response) => new Promise((resolve, reject) => {
                tmp.file({ mode: 0o600,
                           keep: true,
                           dir: this._platform.getTmpDir(),
                           prefix: 'thingengine-' + this._id + '-',
                           postfix: '.zip' }, (err, path, fd, cleanup) => {
                    if (err)
                        reject(err);
                    else
                        resolve([path, fd, cleanup]);
                });
            }).then(([path, fd]) => {
                var stream = fs.createWriteStream('', { fd, flags: 'w' });

                return new Promise((callback, errback) => {
                    response.pipe(stream);
                    stream.on('finish', () => {
                        callback(path);
                    });
                    stream.on('error', errback);
                });
            })
        ).then((zipPath) => {
            try {
                fs.mkdirSync(this._modulePath);
            } catch(e) {
                if (e.code !== 'EEXIST')
                    throw e;
            }

            var unzip = this._platform.getCapability('code-download');
            return unzip.unzip(zipPath, this._modulePath).then(() => {
                fs.unlinkSync(zipPath);
            });
        }).then(() => this._loadJsModule()).catch((e) => {
            this._loading = null;
            throw e;
        });
    }
};