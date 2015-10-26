// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const BaseChannel = require('../../base_channel');

const DistributedDatabaseSourceChannel = new lang.Class({
    Name: 'DistributedDatabaseSourceChannel',
    Extends: BaseChannel,

    _init: function(engine, device) {
        this.parent();

        this._timeout = -1;
    },

    _doOpen: function() {
        var messaging = platform.getCapability('messaging');
        if (messaging === null)
            throw new Error('Required capability messaging is missing');

        return Q();
    },

    _doClose: function() {
        clearInterval(this._timeout);
        this._timeout = -1;
        return Q();
    }
});

function createChannel() {
    return new TestChannel();
}

module.exports.createChannel = createChannel;
module.exports.requiredCapabilities = ['messaging'];
