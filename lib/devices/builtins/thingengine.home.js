// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

module.exports = class ThingEngineHomeDevice extends Tp.BaseDevice {
    constructor(engine, state) {
        super(engine, state);

        // This is a built-in device so we're allowed some
        // "friendly" API access
        this._tierManager = engine._tiers;

        this.uniqueId = 'org.thingpedia.builtin.thingengine.home';

        this.name = this.engine._("Almond Home");
        this.description = this.engine._("Control your Almond Home with your voice.");
    }

    get ownerTier() {
        return Tp.Tier.SERVER;
    }

    checkAvailable() {
        if (Tp.Tier.SERVER === this._tierManager.ownTier) {
            return Tp.Availability.AVAILABLE;
        } else {
            return (this._tierManager.isConnected(Tp.Tier.SERVER) ?
                    Tp.Availability.AVAILABLE :
                    Tp.Availability.OWNER_UNAVAILABLE);
        }
    }

    do_start_playing({ link }) {
        let player = this.engine.platform.getCapability('media-player');
        return player.startPlaying(String(link));
    }
    do_stop_playing() {
        let player = this.engine.platform.getCapability('media-player');
        return player.stopPlaying();
    }
};
