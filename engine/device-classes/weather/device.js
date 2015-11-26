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

// Weather forecast for the current location
//
// FIXME: refactor me!
const WeatherDevice = new lang.Class({
    Name: 'WeatherDevice',
    Extends: BaseDevice,

    _init: function(engine, state) {
        this.parent(engine, state);

        this.uniqueId = 'yrno-weather';

        this.name = "Yr.no Weather";
        this.description = "Yr.no Weather shows the current weather conditions and weather forecast where your phone is";
    },

    get ownerTier() {
        return Tier.GLOBAL;
    },

    checkAvailable: function() {
        return BaseDevice.Availability.AVAILABLE;
    }
});

function createDevice(engine, state) {
    return new WeatherDevice(engine, state);
}

module.exports.createDevice = createDevice;
