// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');

const ModuleDownloader = require('./module_downloader');

module.exports = new lang.Class({
    Name: 'DeviceFactory',
    $rpcMethods: ['get SupportedKinds', 'getConfigUI'],

    // hardcoded for now, we'll see about that at some point in the future
    SupportedKinds: [{ kind: 'test', desc: "ThingEngine™ Test Device", online: false },
                     { kind: 'google-account', desc: "Google Account", online: true },
                     { kind: 'bodytrace-scale', desc: "BodyTrace Scale", online: false }],

    _init: function(engine) {
        this._engine = engine;
        this._downloader = new ModuleDownloader('devices');
    },

    getFactory: function(kind) {
        return this._downloader.getModule(kind);
    },

    getConfigUI: function(kind) {
        return this.getFactory(kind).then(function(factory) {
            return factory.getConfigUI();
        });
    },

    createDevice: function(kind, serializedDevice) {
        return this.getFactory(kind).then(function(factory) {
            return factory.createDevice(this._engine, serializedDevice);
        }.bind(this));
    }
});
