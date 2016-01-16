// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Tp = require('thingpedia');

module.exports = new Tp.DeviceClass({
    Name: 'SportRadarDevice',

    _init: function(engine, state) {
        this.parent(engine, state);

        this.uniqueId = 'sportradar';
        this.isTransient = true;

        this.name = "SportRadar";
        this.description = "SportRadar is a quick source of Sport Results and info and stuff.";
    },

    get ownerTier() {
        return Tp.Tier.GLOBAL;
    },

    checkAvailable: function() {
        return Tp.Availability.AVAILABLE;
    }
});

