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

// A device that reacts to user input on the phone app
const UIDevice = new lang.Class({
    Name: 'UIDevice',
    Extends: BaseDevice,

    _init: function(engine, state) {
        this.parent(engine, state);

        this.uniqueId = 'thingengine-system-ui';

        this.name = "System UI";
        this.description = "System UI collects the interaction with the ThingEngine Phone App";
    },

    get ownerTier() {
        return Tier.PHONE;
    },

    checkAvailable: function() {
        return this.engine.tiers.isConfigured(Tier.PHONE) ?
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
    return new UIDevice(engine, state);
}

module.exports.createDevice = createDevice;
