// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const lang = require('lang');

const omclient = require('omclient').client;

const BaseDevice = require('../../base_device');

const OmletMessaging = require('./omlet_messaging');

const OmletDevice = new lang.Class({
    Name: 'OmletDevice',
    Extends: BaseDevice,

    _init: function(engine, state) {
        this.parent(engine, state);

        this.name = "Omlet Account %s".format(this.omletId);
        this.description = "This is your Omlet Account. You can use it to communicate and share data with your friends!";
    },

    get omletInstance() {
        return this.state.instance;
    }

    get omletId() {
        return this.state.omletId;
    },

    hasKind: function(kind) {
        switch(kind) {
        case 'messaging':
            return true;
        default:
            return this.parent();
        }
    },

    queryInterface: function(iface) {
        if (iface === 'omlet')
            return new omclient.Client({ instance: this.omletInstance });
        else if (iface === 'messaging')
            return new OmletMessaging(this);
        else
            return null;
    },

    checkAvailable: function() {
        return BaseDevice.Availability.AVAILABLE;
    },
});

function createDevice(engine, state) {
    return new OmletDevice(engine, state);
}
module.exports.createDevice = createDevice;
