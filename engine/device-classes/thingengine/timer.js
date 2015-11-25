// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//                Jiwon Seo <jiwon@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const BaseChannel = require('../../base_channel');

var cnt = 0;

const TimerChannel = new lang.Class({
    Name: 'TimerChannel',
    Extends: BaseChannel,

    _init: function(engine, device, params) {
        this.parent();

        cnt++;
        console.log('Created Timer channel #' + cnt);

        if (params.length !== 1 ||
            !params[0].isMeasure ||
            params[0].unit !== 'ms')
            throw new Error('Invalid @$timer parameters');

        this._interval = params[0].value;
        this.filterString = 'interval-' + this._interval;
        this._timeout = -1;
    },

    _doOpen: function() {
        this._timeout = setInterval(function() {
            var event = [this._interval];

            console.log('Emitting timer event', event);
            this.emitEvent(event);
            this.emitEvent(null);

        }.bind(this), this._interval);
        return Q();
    },

    _doClose: function() {
        clearInterval(this._timeout);
        this._timeout = null;
        return Q();
    }
});

function createChannel(engine, device, params) {
    return new TimerChannel(engine, device, params);
}

module.exports.createChannel = createChannel;
module.exports.requiredCapabilities = [];
