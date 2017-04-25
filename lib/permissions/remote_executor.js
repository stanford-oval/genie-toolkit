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

module.exports = class RemoteExecutor {
    constructor(permissions) {
        this._permissions = permissions;
    }

    execute(principal, device, channelType, channel, args) {
        return this._permissions.isAllowed(principal, device, channelType, channel, args).then((allowed) => {
            if (!allowed) {
                var e = new Error('Permission denied');
                e.code = 'EPERM';
                throw e;
            }

            throw new Error('Not Implemented');
        });
    }
}
