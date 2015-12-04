// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');

const ModuleDownloader = require('./downloader');

module.exports = new lang.Class({
    Name: 'DeviceFactory',
    $rpcMethods: ['runOAuth2'],

    _init: function(engine) {
        this._engine = engine;
        this._downloader = new ModuleDownloader();
    },

    getSubmodule: function(kind, subkind) {
        return this._downloader.getSubmodule(kind, subkind);
    },

    getFactory: function(kind) {
        return this._downloader.getModule(kind);
    },

    runOAuth2: function(kind, req) {
        return this.getFactory(kind).then(function(factory) {
            return factory.runOAuth2(this._engine, req);
        }.bind(this));
    },

    addFromDiscovery: function(kind, publicData, privateData) {
        return this.getFactory(kind).then(function(factory) {
            return factory.addFromDiscovery(this._engine, publicData, privateData);
        });
    },

    createDevice: function(kind, serializedDevice) {
        return this.getFactory(kind).then(function(factory) {
            return factory.createDevice(this._engine, serializedDevice);
        }.bind(this));
    }
});
