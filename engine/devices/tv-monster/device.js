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

const TVMonsterDevice = new lang.Class({
    Name: 'TVMonsterDevice',
    Extends: BaseDevice,

    _init: function(engine, state) {
        this.parent(engine, state);

        this.account = '12345678';
        this.username = 'John Doe';
        this.accessToken = '1234567890password';

        this.uniqueId = 'tv-monster-' + this.account.replace(/\./g,'-');

        this.name = "TV Monster™ belonging to %s".format(this.username);
        this.description = "This is a TV Monster. It collects stuff from the Internets.";
    },

    hasKind: function(kind) {
        switch (kind) {
        case 'online-account':
            return true;

        default:
            return this.parent(kind);
        }
    },

    checkAvailable: function() {
        return BaseDevice.Availability.AVAILABLE;
    },
});

function createDevice(engine, state) {
    return new TVMonsterDevice(engine, state);
}
function runOAuth2(engine, req) {
    var device = new TVMonsterDevice(engine, { kind: 'tv-monster' });
    engine.devices.addDevice(device);
    return null;
}

module.exports.createDevice = createDevice;
module.exports.runOAuth2 = runOAuth2;
