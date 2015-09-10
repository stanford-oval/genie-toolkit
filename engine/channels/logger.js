// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const BaseChannel = require('../base_channel');

var cnt = 0;

const LoggingChannel = new lang.Class({
    Name: 'LoggingChannel',
    Extends: BaseChannel,

    _init: function() {
        this.parent();

        cnt++;
        console.log('Created LoggingChannel #' + cnt);

        this._timeout = -1;
    },

    get isSource() {
        return true;
    },
    get isSink() {
        return true;
    },

    // For testing only
    get isSupported() {
        return platform.type === 'android';
    },

    sendEvent: function(event) {
        console.log("LoggingChannel received event:", event);
    }

});

function createChannel() {
    return new LoggingChannel();
}

module.exports.createChannel = createChannel;
