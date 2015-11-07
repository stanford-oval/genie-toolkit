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

var cnt = 0;

const TimerChannel = new lang.Class({
    Name: 'TimerChannel',
    Extends: BaseChannel,

    _init: function(engine, device, filters) {
        this.parent();

        cnt++;
        console.log('Created Timer channel #' + cnt);

        // figure out the interval
        var interval = 0;
        for (var i = 0; i < filters.length; i++) {
            if (filters[i].isThreshold) {
                if (filters[i].lhs.name === 'interval') {
                    interval = filters[i].rhs.value.value;
                    break;
                }
            } else {
                throw new TypeError();
            }
        }
        if (interval <= 0)
            interval = 1000;

        this._interval = interval;
        this.filterString = 'interval-' + this._interval;
        this._timeout = -1;
    },

    _doOpen: function() {
        this._timeout = setInterval(function() {
            var event = { interval: this._interval, ts: new Date };
            console.log('Emitting timer event', event);
            this.emitEvent(event);
        }.bind(this), this._interval);
        return Q();
    },

    _doClose: function() {
        clearInterval(this._timeout);
        this._timeout = -1;
        return Q();
    }
});

function createChannel(engine, device, filters) {
    return new TimerChannel(engine, device, filters);
}

module.exports.createChannel = createChannel;
module.exports.requiredCapabilities = [];
