// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const BaseDevice = require('../../base_device');
const Tier = require('../../tier_manager').Tier;

// A device that logs on the private server stdout
const LoggerDevice = new lang.Class({
    Name: 'LoggerDevice',
    Extends: BaseDevice,

    _init: function(engine, state) {
        this.parent(engine, state);

        this.uniqueId = 'thingengine-system-logger';

        this.name = "System Logger";
        this.description = "System Logger collects all messages in a central location for you to access.";
    },

    get ownerTier() {
        return Tier.SERVER;
    },

    checkAvailable: function() {
        return this.engine.tiers.isConfigured(Tier.SERVER) ?
            BaseDevice.Availability.AVAILABLE :
            BaseDevice.Availability.UNAVAILABLE;
    },

    hasKind: function(kind) {
        switch(kind) {
        case 'thingengine-system':
            return true;
        default:
            return this.parent(kind);
        }
    },
});

function createDevice(engine, state) {
    return new LoggerDevice(engine, state);
}

module.exports.createDevice = createDevice;
