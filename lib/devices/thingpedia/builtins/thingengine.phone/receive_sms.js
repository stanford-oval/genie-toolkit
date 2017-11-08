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

module.exports = class ReceiveSmsChannel extends Tp.BaseChannel {
    static get requiredCapabilities() {
        return ['sms'];
    }

    constructor(engine, device, params) {
        super(engine, device);
        this._sms = engine.platform.getCapability('sms');
    }

    formatEvent(event) {
        return this.engine._("New SMS from %s: %s").format(event[0], event[1]);
    }

    _doOpen() {
        this._sms.onsmsreceived = this._onSmsReceived.bind(this);
        return this._sms.start();
    }

    _doClose() {
        this._sms.onsmsreceived = null;
        return this._sms.stop();
    }

    _onSmsReceived(error, sms) {
        this.emitEvent([sms.from, sms.body]);
    }
}
