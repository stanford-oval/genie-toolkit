// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const BaseDevice = require('../base_device');

const SportRadarDevice = new lang.Class({
    Name: 'SportRadarDevice',
    Extends: BaseDevice,

    _init: function(engine, state) {
        this.parent(engine, state);

        this.uniqueId = 'sportradar';
        this.isTransient = true;

        this.name = "SportRadar";
        this.description = "SportRadar is a quick source of Sport Results and info and stuff.";
    },

    get ownerTier() {
        return 'global';
    },

    checkAvailable: function() {
        return BaseDevice.Availability.AVAILABLE;
    }
});

function createDevice(engine, state) {
    return new SportRadarDevice(engine, state);
}

module.exports.createDevice = createDevice;
