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
    Name: 'ReceiveSmsChannel',
    RequiredCapabilities: ['sms'],

    _init: function(engine, device, params) {
        this.parent();

        this._sms = engine.platform.getCapability('sms');
    },

    _doOpen: function() {
        this._sms.onsmsreceived = this._onSmsReceived.bind(this);
        return this._sms.start();
    },

    _doClose: function() {
        this._sms.onsmsreceived = null;
        return this._sms.stop();
    },

    _onSmsReceived: function(error, sms) {
        this.emitEvent([sms.from, sms.body]);
    }
});
