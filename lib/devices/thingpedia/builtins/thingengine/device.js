// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

// The running thingengine, as a device. This is mostly a
// placeholder for syncdb credentials, that ConfigPairing can
// pick up and pass to TierManager.
module.exports = class ThingEngineDevice extends Tp.BaseDevice {
    constructor(engine, state) {
        super(engine, state);

        this.tier = state.tier;
        this.own = true;

        if (this.tier === Tp.Tier.CLOUD) {
            this._checkCloudIdDevKey(state);
            this.cloudId = state.cloudId;
            this.developerKey = state.developerKey;
        } else if (this.tier === Tp.Tier.SERVER) {
            this.host = state.host;
            this.port = state.port;

            if (typeof state.port != 'number' || isNaN(state.port))
                throw new TypeError('Invalid port number ' + state.port);
        } else if (this.tier === Tp.Tier.PHONE) {
            this.messagingId = state.messagingId;
        }

        // This is a built-in device so we're allowed some
        // "friendly" API access
        this._tierManager = engine._tiers;

        this.uniqueId = 'thingengine-own-' + this.tier;
        this.name = this.engine._("ThingEngine %s").format(this.tier);
        this.description = this.engine._("This is your own ThingEngine.");
    }

    updateState(state) {
        super.updateState(state);
        if (this.tier === Tp.Tier.CLOUD) {
            this.developerKey = state.developerKey;
            this.engine.platform.setDeveloperKey(state.developerKey);
        }
    }

    _checkCloudIdDevKey(state) {
        if (this.engine.ownTier !== Tp.Tier.CLOUD)
            return;
        var changed = false;

        if (state.cloudId !== this.engine.platform.getCloudId()) {
            state.cloudId = this.engine.platform.getCloudId();
            changed = true;
        }
        if (state.developerKey !== this.engine.platform.getDeveloperKey()) {
            state.developerKey = this.engine.platform.getDeveloperKey();
            changed = true;
        }

        if (changed) {
            setTimeout(() => {
                this.stateChanged();
            }, 1000);
        }
    }

    get ownerTier() {
        return this.tier;
    }

    checkAvailable() {
        if (this.tier === this._tierManager.ownTier)
            return Tp.Availability.AVAILABLE;
        else
            return (this._tierManager.isConnected(this.tier) ?
                    Tp.Availability.AVAILABLE :
                    Tp.Availability.OWNER_UNAVAILABLE);
    }

    hasKind(kind) {
        switch (kind) {
        case 'thingengine-system':
        case 'thingengine-own':
            return true;
        case 'thingengine-server':
            return this.tier === Tp.Tier.SERVER;
        case 'thingengine-phone':
            return this.tier === Tp.Tier.PHONE;
        case 'thingengine-cloud':
            return this.tier === Tp.Tier.CLOUD;
        default:
            return super.hasKind(kind);
        }
    }
}
