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

const TimerChannel = new lang.Class({
    Name: 'TimerChannel',
    Extends: BaseChannel,

    _init: function(interval) {
        this.parent();

        cnt++;
        console.log('Created Test channel #' + cnt);

        // convert from s to ms
        this._interval = interval * 1000;
        this._timeout = -1;
    },

    _doOpen: function() {
        this._timeout = setInterval(function() {
            var event = {"now": new Date};
            this.emitEvent(event, true);
        }.bind(this), this._interval);
        return Q();
    },

    _doClose: function() {
        clearInterval(this._timeout);
        this._timeout = -1;
        return Q();
    }
});

function createChannel(engine, timeout) {
    return new TimerChannel(timeout);
}

module.exports.createChannel = createChannel;
module.exports.requiredCapabilities = [];
