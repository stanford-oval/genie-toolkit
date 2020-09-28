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

import * as ThingTalk from 'thingtalk';
const Ast = ThingTalk.Ast;

import { coin } from '../../utils/random';
import AbstractDialogueAgent from '../abstract_dialogue_agent';

import StatementSimulator from './statement_simulator';

/**
 * The dialogue agent used at simulation time.
 *
 * This is a completely stateless class, as it handles many possible dialogues at the same
 * time.
 */
export default class SimulationDialogueAgent extends AbstractDialogueAgent {
    constructor(options) {
        super(options.schemaRetriever, {
            locale: options.locale,
            debug: false,
            timezone: 'America/Los_Angeles',
        });
        this._executor = new StatementSimulator(options);

        this._thingpedia = options.thingpediaClient;
        this._rng = options.rng;
        this._database = options.database;
        this._interactive = options.interactive;
    }

    get executor() {
        return this._executor;
    }

    getAllDevicesOfKind(kind) {
        // make up a unique fake device, and make the uniqueId same as the kind,
        // so the device will not be recorded in the context
        // TODO when we actually support choosing devices (when dealing with IoT)
        // this needs to be revised
        return [{
            kind, name: kind, uniqueId: kind
        }];
    }

    async tryConfigureDevice(kind) {
        throw new TypeError('Should not attempt to configure devices in simulation');
    }

    async disambiguate(type, name, choices, hint) {
        // pick something at random...
        return Math.floor(this._rng() * choices.length);
    }

    async lookupContact(category, name) {
        // TODO???
        throw new TypeError('Abstract method');
    }

    async addDisplayToContact(contact) {
        // do nothing, all our entities are made up in the simulation
        // and we don't care about the display field
    }

    async askMissingContact(category, name) {
        // TODO???
        throw new TypeError('Abstract method');
    }

    async lookupLocation(searchKey, previousLocations) {
        // should not happen in non-interactive mode, we only deal with absolute locations
        // and let the augmentation step convert to location names later
        if (!this._interactive)
            throw new Error('Cannot look up locations in non-interactive mode');

        const lastLocation = previousLocations.length ? previousLocations[previousLocations.length - 1] : undefined;

        let around;
        if (lastLocation)
            around = { latitude: lastLocation.lat, longitude: lastLocation.lon };
        let candidates = await this._thingpedia.lookupLocation(searchKey, around);

        // ignore locations larger than a city
        candidates = candidates.filter((c) => c.rank >= 16).map((c) => {
            return new Ast.Location.Absolute(c.latitude, c.longitude, c.display);
        });

        if (candidates.length === 0)
            throw new Error(`Cannot find any location matching “${searchKey}”`);
        return new Ast.Value.Location(candidates[0]);
    }

    _getIDs(type) {
        return this._database.get(type).map((entry) => {
            return {
                value: entry.id.value,
                name: entry.id.display,
                canonical: entry.id.display
            };
        });
    }

    async lookupEntityCandidates(entityType, entityDisplay) {
        if (this._database && this._database.has(entityType))
            this._getIDs(entityType);

        // in interactive mode, we query thingpedia for real
        if (this._interactive) {
            const { data: candidates, } = await this._thingpedia.lookupEntity(entityType, entityDisplay);
            return candidates;
        } else {
            // return nothing...
            return [];
        }
    }

    async resolveUserContext(variable) {
        switch (variable) {
        case '$context.location.current_location':
            return new Ast.Value.Location(new Ast.Location.Absolute(2, 2, 'here'));
        case '$context.location.home':
            return new Ast.Value.Location(new Ast.Location.Absolute(3, 3, 'home'));
        case '$context.location.work':
            return new Ast.Value.Location(new Ast.Location.Absolute(4, 4, 'work'));
        case '$context.time.morning':
            return new Ast.Value.Time(new Ast.Time.Absolute(9, 0, 0));
        case '$context.time.evening':
            return new Ast.Value.Time(new Ast.Time.Absolute(19, 0, 0));
        default:
            throw new Error(`Unknown $context variable ${variable}`);
        }
    }

    getPreferredUnit(type) {
        switch (type) {
        case 'temperature':
            if (this._interactive)
                return 'F';
            else
                return coin(0.5, this._rng) ? 'C' : 'F';
        default:
            throw new Error('Invalid default unit');
        }
    }
}
