// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016-2017 The Board of Trustees of the Leland Stanford Junior University
//           2018 Google LLC
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const { tryGetCurrentLocation } = require('../utils');
const { getBestEntityMatch } = require('./entity-finder');

async function lookupEntity(dlg, entityType, entityDisplay, idEntities) {
    if (idEntities.has(entityType))
        return getBestEntityMatch(entityDisplay, idEntities.get(entityType));

    // HACK this should be made generic with some new Genie annotation
    if (entityType === 'org.freedesktop:app_id' && dlg.manager.platform.hasCapability('app-launcher')) {
        const candidates = await dlg.manager.platform.getCapability('app-launcher').listApps();
        return getBestEntityMatch(entityDisplay, candidates);
    }

    const { data:candidates, meta } = await dlg.manager.thingpedia.lookupEntity(entityType, entityDisplay);

    if (candidates.length === 0) {
        await dlg.replyInterp(dlg._("Sorry, I cannot find any ${entity_type} matching “${name}”."), {
            entity_type: meta.name,
            name: entityDisplay
        });
        return null;
    }

    const best = getBestEntityMatch(entityDisplay, candidates);
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
