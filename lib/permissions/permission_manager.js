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

    isAllowed(principal, device, channelType, channel, args) {
        return Q(false);
    }
}
