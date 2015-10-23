// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const BaseDevice = require('../../base_device');

const BodyTraceScaleDevice = new lang.Class({
    Name: 'BodyTraceScaleDevice',
    Extends: BaseDevice,

    _init: function(engine, state) {
        this.parent(engine, state);

        this.serial = state.serial;
        this.username = state.username;
        this.password = state.password;

        this.uniqueId = 'bodytrace-scale-' + this.serial;

        this.name = "BodyTrace Scale %s".format(this.serial);
        this.description = "This is a BodyTrace Scale owned by %s"
            .format(this.username);
    },

    hasKind: function(kind) {
        switch (kind) {
        case 'scale':
            return true;
        default:
            return this.parent(kind);
        }
    },

    // it's cloud backed so always available
    checkAvailable: function() {
        return BaseDevice.Availability.AVAILABLE;
    },
});

function createDevice(engine, state) {
    return new BodyTraceScaleDevice(engine, state);
}

module.exports.createDevice = createDevice;
