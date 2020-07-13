// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2018 Google LLC
//           2018-2020 The Board of Trustees of the Leland Stanford Junior University
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

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const { tryGetCurrentLocation } = require('../utils');
const { getBestEntityMatch } = require('./entity-finder');

async function lookupEntity(dlg, entityType, entityDisplay, idEntities) {
    if (idEntities.has(entityType))
        return getBestEntityMatch(entityDisplay, entityType, idEntities.get(entityType));

    // HACK this should be made generic with some new Genie annotation
    if (entityType === 'org.freedesktop:app_id' && dlg.manager.platform.hasCapability('app-launcher')) {
        const candidates = await dlg.manager.platform.getCapability('app-launcher').listApps();
        return getBestEntityMatch(entityDisplay, entityType, candidates);
    }

    const { data:candidates, meta } = await dlg.manager.thingpedia.lookupEntity(entityType, entityDisplay);

    if (candidates.length === 0) {
        await dlg.replyInterp(dlg._("Sorry, I cannot find any ${entity_type} matching “${name}”."), {
            entity_type: meta.name,
            name: entityDisplay
        });
        return null;
    }

    const best = getBestEntityMatch(entityDisplay, entityType, candidates);
    //console.log('resolved entity ' + entityDisplay + ' of type ' + entityType + ' to ' + best.value);
    return best;
}

async function lookupLocation(dlg, searchKey, previousLocations) {
    const currentLocation = await tryGetCurrentLocation(dlg);
    const lastLocation = previousLocations.length ? previousLocations[previousLocations.length-1] : undefined;

    let around;
    if (lastLocation)
        around = { latitude: lastLocation.lat, longitude: lastLocation.lon };
    else if (currentLocation)
        around = { latitude: currentLocation.latitude, longitude: currentLocation.longitude };

    let candidates = await dlg.manager.thingpedia.lookupLocation(searchKey, around);

    // ignore locations larger than a city
    candidates = candidates.filter((c) => c.rank >= 16).map((c) => {
        return new Ast.Location.Absolute(c.latitude, c.longitude, c.display);
    });

    if (candidates.length === 0) {
        await dlg.replyInterp(dlg._("Sorry, I cannot find any location matching “${location}”."), {
            location: searchKey
        });
        return null;
    }

    return candidates[0];
}

module.exports = {
    getBestEntityMatch,
    lookupEntity,
    lookupLocation
};
