// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
"use strict";

const interpolate = require('string-interp');
const Tp = require('thingpedia');

// The running thingengine, as a device. This is mostly a
// placeholder for syncdb credentials, that ConfigPairing can
// pick up and pass to TierManager.
module.exports = class ThingEngineDevice extends Tp.BaseDevice {
    constructor(engine, state) {
        super(engine, state);

        this.tier = state.tier;

        // for compat with the currently deployed cloud server (which does not understand
        // identity) we normalize identity to ''
        this.identity = state.identity || '';
        this.address = this.tier + this.identity;
        this.own = true;

        // This is a built-in device so we're allowed some
        // "friendly" API access
        this._tierManager = engine._tiers;

        if (this.tier === Tp.Tier.CLOUD) {
            this._checkCloudIdDevKey(state);
            this.cloudId = state.cloudId;
            this.developerKey = state.developerKey;
            if (this._tierManager.ownTier !== Tp.Tier.CLOUD)
                this.engine.platform.setDeveloperKey(state.developerKey);
        } else if (this.tier === Tp.Tier.SERVER) {
            this.host = state.host;
            this.port = state.port;

            if (typeof state.port !== 'number' || isNaN(state.port))
                throw new TypeError('Invalid port number ' + state.port);
        }

        this.uniqueId = 'thingengine-own-' + this.address;
        this.name = interpolate(this.engine._("Almond ${tier} (${identity})"), this.state, {
            locale: this.platform.locale
        });
        this.description = this.engine._("This is one of your own Almond apps.");
    }

    updateState(state) {
        super.updateState(state);
        if (this.tier === Tp.Tier.CLOUD) {
            this.developerKey = state.developerKey;
            this.engine.platform.setDeveloperKey(state.developerKey);
        }
    }

    _checkCloudIdDevKey(state) {
        if (this._tierManager.ownTier !== Tp.Tier.CLOUD)
            return;
        let changed = false;

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
        if (this.tier === this._tierManager.ownTier) {
            return Tp.Availability.AVAILABLE;
        } else {
            return (this._tierManager.isConnected(this.address) ?
                    Tp.Availability.AVAILABLE :
                    Tp.Availability.OWNER_UNAVAILABLE);
        }
    }
};
