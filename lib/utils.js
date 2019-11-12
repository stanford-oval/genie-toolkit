// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Silei Xu <silei@cs.stanford.edu>
//
// See COPYING for details

"use strict";

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

async function tryGetCurrentLocation(dlg) {
    const gps = dlg.manager.platform.getCapability('gps');
    if (gps === null)
        return null;
    const location = await gps.getCurrentLocation();
    if (location === null) {
        console.log('GPS location not available');
        return null;
    } else {
        return new Ast.Value.Location(new Ast.Location.Absolute(location.latitude, location.longitude, location.display||null));
    }
}

function distance(l1, l2) {
    const diffLat = Math.abs(l1.lat - l2.lat);
    const diffLon = Math.abs(l1.lon - l2.lon);
    return Math.sqrt(diffLat ** 2 + diffLon ** 2);
}

module.exports = {
    tryGetCurrentLocation,
    distance
};
