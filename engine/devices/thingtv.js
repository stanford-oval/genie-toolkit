// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const BaseDevice = require('../base_device');

const ThingTVDevice = new lang.Class({
    Name: 'ThingTVDevice',
    Extends: BaseDevice,

    _init: function(engine, state) {
        this.parent(engine, state);

        this.host = state['ip-address'];
        this.port = parseInt(state.port);

        if (isNaN(this.port))
            throw new TypeError('Invalid port number ' + state.port);

        this.uniqueId = 'thingtv-' + this.host.replace(/./g,'-') + '-' + state.port;

        this.name = "ThingTV™ at %s:%d".format(this.host, this.port);
        this.description = "This is a ThingTV. It shows stuff from the Internets.";
    },

    hasKind: function(kind) {
        switch (kind) {
        case 'tv':
        case 'media-output':
            return true;

        default:
            return this.parent(kind);
        }
    },

    // FIXME: ping the TV...
    checkAvailable: function() {
        return BaseDevice.Availability.AVAILABLE;
    },
});

function createDevice(engine, state) {
    return new ThingTVDevice(engine, state);
}

module.exports.createDevice = createDevice;
