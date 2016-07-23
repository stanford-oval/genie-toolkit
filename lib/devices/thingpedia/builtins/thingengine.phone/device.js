// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

// The phone running this instance of ThingEngine, and its
// phone specific channels (like sms and popup notifications)
module.exports = new Tp.DeviceClass({
    Name: 'ThingEnginePhoneDevice',

    _init: function(engine, state) {
        this.parent(engine, state);

        // This is a built-in device so we're allowed some
        // "friendly" API access
        this._tierManager = engine._tiers;

        this.uniqueId = 'org.thingpedia.builtin.thingengine.phone';

        this.name = "Phone";
        this.description = "Access your phone capabilities from Sabrina.";
    },

    get ownerTier() {
        return Tp.Tier.PHONE;
    },

    checkAvailable: function() {
        if (this.tier === this._tierManager.ownTier)
            return Tp.Availability.AVAILABLE;
        else
            return (this._tierManager.isConnected(Tp.Tier.PHONE) ?
                    Tp.Availability.AVAILABLE :
                    Tp.Availability.OWNER_UNAVAILABLE);
    }
});
