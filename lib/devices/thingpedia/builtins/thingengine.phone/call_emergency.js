// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

module.exports = class CallEmergencyChannel extends Tp.BaseChannel {
    static get requiredCapabilities() {
        return ['telephone'];
    }

    constructor(engine, device, params) {
        super(engine, device);
        this._telephone = engine.platform.getCapability('telephone');
    }

    sendEvent() {
        this._telephone.callEmergency().catch(function(e) {
            console.error('Failed to place phone call: ' + e.message);
        });
    }
}
