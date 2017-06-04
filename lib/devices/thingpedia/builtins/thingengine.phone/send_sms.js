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

module.exports = class SetRingerChannel extends Tp.BaseChannel {
    static get requiredCapabilities() {
        return ['sms'];
    }

    constructor(engine, device, params) {
        super(engine, device);
        this._sms = engine.platform.getCapability('sms');
    }

    sendEvent([phoneNumber, text]) {
        this._sms.sendMessage(phoneNumber, text).catch(function(e) {
            console.error('Failed to set ringer mode: ' + e.message);
        });
    }
}
