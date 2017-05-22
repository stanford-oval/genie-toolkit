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
    Name: 'SetRingerChannel',
    Extends: Tp.SimpleAction,
    RequiredCapabilities: ['audio-manager'],

    _init: function(engine, device, params) {
        this.parent();

        this._audio = engine.platform.getCapability('audio-manager');
    },

    _doInvoke: function(mode) {
        try {
            this._audio.setRingerMode(mode);
        } catch(e) {
            console.error('Failed to set ringer mode: ' + e.message);
        }
    }
});
