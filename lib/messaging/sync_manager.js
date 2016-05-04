// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');

// Control offline sync of the primary messaging device, as defined by
// MessagingDeviceManager
module.exports = class MessagingSyncManager {
    constructor(messaging) {
        this._messaging = messaging;
    }

    start() {
        this._messaging.startSync();
        return Q();
    }

    stop() {
        this._messaging.stopSync();
        return Q();
    }
}
