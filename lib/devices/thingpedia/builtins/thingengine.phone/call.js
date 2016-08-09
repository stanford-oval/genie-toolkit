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
    Name: 'CallChannel',
    Extends: Tp.SimpleAction,
    RequiredCapabilities: ['telephone'],

    _init: function(engine, device, params) {
        this.parent();

        this._telephone = engine.platform.getCapability('telephone');
    },

    _doInvoke: function(phoneNumber) {
        this._telephone.call(phoneNumber).catch(function(e) {
            console.error('Failed to place phone call: ' + e.message);
        });
    }
});
