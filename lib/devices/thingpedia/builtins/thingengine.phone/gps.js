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

module.exports = class GpsChannel extends Tp.BaseChannel {
    static get requiredCapabilities() {
        return ['gps'];
    }

    constructor(engine, device, params) {
        super(engine, device);

        this._gps = engine.platform.getCapability('gps');
    }

    formatEvent([location, altitude, bearing, speed], filters, hint, formatter) {
        return this.engine._("Current Location: %s").format(formatter.locationToString(location));
    }

    _doOpen() {
        this._gps.onlocationchanged = this._onLocationChanged.bind(this);
        return this._gps.start();
    }

    _doClose() {
        this._gps.onlocationchanged = null;
        return this._gps.stop();
    }

    _onLocationChanged(error, location) {
        if (location === null)
            this.emitEvent(null);
        else
            this.emitEvent([{ x: location.longitude, y: location.latitude, display: location.display },
                            location.altitude,
                            location.bearing,
                            location.speed]);
    }
}
