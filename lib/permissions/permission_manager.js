// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

const Config = require('../config');

module.exports = class PermissionManager {
    constructor() {
    }

    isAllowedAction(principal, device, channel, args) {
        if (device.isBuiltin)
            return Q(false);
        if (device.isGlobalName && device.name === 'twitter' && channel === 'sink')
            return Q(true);
        return Q(false);
    }

    isAllowedQuery(principal, device, channel, args) {
        if (device.isBuiltin)
            return Q(false);
        return Q(false);
    }

    isAllowedQueryResult(principal, device, channel, args, result) {
        return Q(false);
    }
}
