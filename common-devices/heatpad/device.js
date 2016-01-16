// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Tp = require('thingpedia');

module.exports = new Tp.DeviceClass({
    Name: 'HeatPadDevice',

    _init: function(engine, state) {
        this.parent(engine, state);

        this.account = state.account;
        this.password = state.password;

        this.uniqueId = 'thingengine-device-heatpad-' + this.account;

        this.name = "Heatpad Device";
        this.description = "The device allows you to turn on/off your heatpad.";
    },

    get ownerTier() {
        return Tp.Tier.SERVER;
    },

    checkAvailable: function() {
        return Tp.Availability.AVAILABLE;
    },
});
