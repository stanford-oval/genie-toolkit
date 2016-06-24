// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const ModuleDownloader = require('./downloader');

module.exports = class DeviceFactory {
    constructor(engine, client) {
        this._engine = engine;
        this._downloader = new ModuleDownloader(engine.platform, client);
    }

    getCachedModules() {
        return this._downloader.getCachedMetas();
    }

    updateFactory(kind) {
        return this._downloader.updateModule(kind);
    }

    getFactory(kind) {
        return this._downloader.getModule(kind);
    }

    runOAuth2(kind, req) {
        return this.getFactory(kind).then(function(factory) {
            return factory.runOAuth2(this._engine, req);
        }.bind(this));
    }

    loadFromDiscovery(kind, publicData, privateData) {
        return this.getFactory(kind).then(function(factory) {
            return factory.loadFromDiscovery(this._engine, publicData, privateData);
        }.bind(this));
    }

    createDevice(kind, serializedDevice) {
        return this.getFactory(kind).then(function(factory) {
            if (typeof factory === 'function')
                return new factory(this._engine, serializedDevice);
            else
                return factory.createDevice(this._engine, serializedDevice);
        }.bind(this));
    }
}
module.exports.prototype.$rpcMethods = ['runOAuth2', 'getCachedModules'];
