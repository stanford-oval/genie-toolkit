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

const TimerDevice = new lang.Class({
    Name: 'TimerDevice',
    Extends: BaseDevice,

    _init: function(engine, state) {
        this.parent(engine, state);

        this.uniqueId = 'thingengine-system-timer';

        this.name = "System Timer";
        this.description = "System Timer is the ever-changing passing of time, packaged as ThingEngine device";
    },

    get ownerTier() {
        return Tier.GLOBAL;
    },

    checkAvailable: function() {
        return BaseDevice.Availability.AVAILABLE;
    },

    // not sure this is needed, because timer lives in @global, not @me, so
    // it's never exposed by the UI anyway...
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
    return new TimerDevice(engine, state);
}

module.exports.createDevice = createDevice;
