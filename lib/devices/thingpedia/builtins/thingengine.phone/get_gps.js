// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const Tp = require('thingpedia');

module.exports = new Tp.ChannelClass({
    Name: 'GpsChannel',
    RequiredCapabilities: ['gps'],

    _init: function(engine, device, params) {
        this.parent(engine, device);

        this._gps = engine.platform.getCapability('gps');
    },

    formatEvent([location, altitude, bearing, speed], filters, hint, formatter) {
        return this.engine._("Current Location: %s").format(formatter.locationToString(location));
    },

    invokeQuery() {
        return this._gps.getCurrentLocation().then((location) => {
            if (location) {
                return [[{ x: location.longitude, y: location.latitude, display: location.display },
                         location.altitude,
                         location.bearing,
                         location.speed]];
            } else {
                return [[{ x: 0, y: 0, display: this.engine._("Unknown") }, 0, 0, 0]];
            }
        });
    }
});
