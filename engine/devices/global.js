// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const events = require('events');
const fs = require('fs');
const lang = require('lang');

//const KINDS = ['sportradar', 'weather'];
const KINDS = [];

// A device discovery manager that handles always available devices with no authentication
module.exports = new lang.Class({
    Name: 'GlobalDeviceManager',

    _init: function(devices) {
        this._devices = devices;
    },

    get isSupported() {
        return true;
    },

    start: function() {
        return Q.all(KINDS.map(function(k) {
            return this._devices.loadOneDevice({ kind: k }, false);
        }, this));
    },

    stop: function() {
        return Q();
    }
});
