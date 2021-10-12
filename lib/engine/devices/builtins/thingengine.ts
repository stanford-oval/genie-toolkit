// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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

import * as Tp from 'thingpedia';

import type TierManager from '../../sync/manager';
import type Engine from '../../index';

interface ThingEngineDeviceState {
    kind : string;
    tier : Tp.Tier;
    identity ?: string;
    cloudId ?: string|null;
    developerKey ?: string|null;
    [key : string] : unknown;
}

interface PlatformWithDeveloperKey extends Tp.BasePlatform {
    setDeveloperKey(key : string|null|undefined) : void;
}

// The running thingengine, as a device. This is mostly a
// placeholder for syncdb credentials, that ConfigPairing can
// pick up and pass to TierManager.
export default class ThingEngineDevice extends Tp.BaseDevice {
    tier : Tp.Tier;
    identity : string;
    address : string;
    own : true;
    cloudId : string|undefined;
    developerKey : string|null|undefined;
    host : string|undefined;
    port : number|undefined;

    private _syncManager : TierManager;

    constructor(engine : Tp.BaseEngine, state : ThingEngineDeviceState) {
        super(engine, state);

        this.tier = state.tier;

        // for compat with the currently deployed cloud server (which does not understand
        // identity) we normalize identity to ''
        this.identity = state.identity || '';
        this.address = this.tier + this.identity;
        this.own = true;

        // This is a built-in device so we're allowed some
        // "friendly" API access
        this._syncManager = (engine as Engine)._sync;

        this.cloudId = undefined;
        this.developerKey = undefined;
        if (this.tier === Tp.Tier.CLOUD) {
            this.cloudId = state.cloudId!;
            this.developerKey = state.developerKey;
            this._checkCloudIdDevKey(state);
            if (this._syncManager.ownTier !== Tp.Tier.CLOUD)
                (engine.platform as PlatformWithDeveloperKey).setDeveloperKey(state.developerKey);
        } else if (this.tier === Tp.Tier.SERVER) {
            this.host = state.host as string;
            if (typeof state.port !== 'number' || isNaN(state.port))
                throw new TypeError('Invalid port number ' + state.port);
            this.port = state.port;
        }

        this.uniqueId = 'thingengine-own-' + this.address;
    }

    updateState(state : ThingEngineDeviceState) {
        super.updateState(state);
        if (this.tier === Tp.Tier.CLOUD)
            (this.engine.platform as PlatformWithDeveloperKey).setDeveloperKey(state.developerKey);
    }

    private _checkCloudIdDevKey(state : ThingEngineDeviceState) {
        if (this._syncManager.ownTier !== Tp.Tier.CLOUD)
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

    async checkAvailable() {
        if (this.tier === this._syncManager.ownTier) {
            return Tp.Availability.AVAILABLE;
        } else {
            return (this._syncManager.isConnected(this.address) ?
                Tp.Availability.AVAILABLE :
                Tp.Availability.OWNER_UNAVAILABLE);
        }
    }
}
