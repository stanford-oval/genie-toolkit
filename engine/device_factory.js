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

    _init: function(engine) {
        this._engine = engine;
        this._downloader = new ModuleDownloader('devices');
    },

    createDevice: function(kind, serializedDevice) {
        return this._downloader.getModule(kind).then(function(factory) {
            return factory.createDevice(this._engine, serializedDevice);
        }.bind(this));
    }
});
