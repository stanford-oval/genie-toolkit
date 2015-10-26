// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');

const ModuleDownloader = require('./module_downloader');
const BaseDevice = require('./base_device');

// A pseudo-device to collect all channels that are system internal,
// such as #timer and #logger
// Note: this is contrast to ThingEngineDevice, which is for channel
// that are specific to one ThingEngine tier (and is a regular device,
// with source/sink channels, etc.)
// This is very system internal, and at some point it might just disappear
const SystemDevice = new lang.Class({
    Name: 'SystemDevice',
    Extends: BaseDevice,

    _init: function(engine) {
        this.parent(engine, {});

        this.uniqueId = 'thingengine-system';
        this.kind = 'thingengine-system';
    },

    hasKind: function(kind) {
        // mark ourselves as system internal
        if (kind === 'thingengine')
            return true;
        else
            return this.parent(kind);
    },

    // by definition, this device is always available
    // although nothing should ever call this
    checkAvailable: function() {
        return BaseDevice.Availability.AVAILABLE;
    },

    queryInterface: function(iface) {
        switch (iface) {
        case 'object-store':
            return this;
        default:
            return null;
        }
    },

    getObjectChannels: function(selectors, mode, filters) {
        if (selectors.length > 2)
            return [];

        if (selectors.length === 2) {
            // match '#pipe .something'
            if (!selectors[0].isTag ||
                selectors[0].name !== 'pipe' ||
                !selectors[1].isId)
                return [];

            var pipeName = selectors[1].name;
            return [this.engine.channels.getNamedPipe(pipeName, mode)];
        } else {
            // match '#something'
            if (!selectors[0].isTag)
                return [];

            return [this.getChannel(selectors[0].name, filters)];
        }
    },
});

module.exports = new lang.Class({
    Name: 'DeviceFactory',
    $rpcMethods: ['runOAuth2'],

    _init: function(engine) {
        this._engine = engine;
        this._downloader = new ModuleDownloader();
    },

    getSubmodule: function(kind, subkind) {
        if (kind === 'thingengine-system')
            return require('./channels/' + subkind);
        else
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

    createDevice: function(kind, serializedDevice) {
        if (kind === 'thingengine-system')
            return new SystemDevice(this._engine);

        return this.getFactory(kind).then(function(factory) {
            return factory.createDevice(this._engine, serializedDevice);
        }.bind(this));
    }
});
