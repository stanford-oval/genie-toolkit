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

const Q = require('q');
const Tp = require('thingpedia');

module.exports = class SetRingerChannel extends Tp.BaseChannel {
    static get requiredCapabilities() {
        return ['audio-manager'];
    }

    constructor(engine, device) {
        super(engine, device);
        this._audio = engine.platform.getCapability('audio-manager');
    }

    sendEvent([mode]) {
        try {
            this._audio.setRingerMode(mode);
        } catch(e) {
            console.error('Failed to set ringer mode: ' + e.message);
        }
    }
}
