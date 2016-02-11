// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

// Control offline sync of the primary messaging device, as defined by
// MessagingDeviceManager
module.exports = new lang.Class({
    Name: 'MessagingSyncManager',

    _init: function(messaging) {
        this._messaging = messaging;
    },

    start: function() {
        this._messaging.startSync();
        return Q();
    },

    stop: function() {
        this._messaging.stopSync();
        return Q();
    },
});
