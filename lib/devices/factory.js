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
        return this._downloader.getModule(kind)
            .then((module) => module.getDeviceFactory());
    }

    getManifest(kind) {
        return this._downloader.getModule(kind)
            .then((module) => module.manifest);
    }

    runOAuth2(kind, req) {
        return this.getFactory(kind).then((factory) => factory.runOAuth2(this._engine, req));
    }

    runInteractiveConfiguration(kind, delegate) {
        return this.getFactory(kind).then((factory) => factory.configureFromAlmond(this._engine, delegate));
    }

    loadFromDiscovery(kind, publicData, privateData) {
        return this.getFactory(kind).then((factory) =>
            factory.loadFromDiscovery(this._engine, publicData, privateData));
    }

    createDevice(kind, serializedDevice) {
        return this.getFactory(kind).then((factory) => {
            if (typeof factory === 'function')
                return new factory(this._engine, serializedDevice);
            else
                return factory.createDevice(this._engine, serializedDevice);
        });
    }
};
module.exports.prototype.$rpcMethods = ['runOAuth2', 'getCachedModules'];
