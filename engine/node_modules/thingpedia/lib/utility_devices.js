// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const BaseDevice = require('./base_device');

const OnlineAccount = new lang.Class({
    Name: 'OnlineAccount',
    Extends: BaseDevice,

    checkAvailable: function() {
        return BaseDevice.Availability.AVAILABLE;
    },

    hasKind: function(kind) {
        switch (kind) {
        case 'online-account':
            return true;
        default:
            return this.parent(kind);
        }
    }
});

module.exports = {
    OnlineAccount: OnlineAccount
};
