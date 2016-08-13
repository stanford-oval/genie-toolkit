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
    Name: 'NotifyChannel',
    Extends: Tp.SimpleAction,
    RequiredCapabilities: ['notify'],

    _init: function(engine, device, params) {
        this.parent();

        this._notify = engine.platform.getCapability('notify');
    },

    _doInvoke: function(title, message) {
        this._notify.showMessage(title, message);
    }
});
