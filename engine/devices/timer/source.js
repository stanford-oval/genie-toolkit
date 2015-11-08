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
        var interval = 0, at = "";
        for (var i = 0; i < filters.length; i++) {
            if (filters[i].isThreshold) {
                if (filters[i].lhs.name === 'interval') {
                    interval = filters[i].rhs.value.value;
                    break;
                }
                if (filters[i].lhs.name === 'at') {
                    at = filters[i].rhs.value.value;
                    console.log("at:"+at);
                    break;
                }
            } else {
                throw new TypeError();
            }
        }
        if (at != "") {
            var now = new Date;
            var timestr = at.split(':');
            var hour = timestr[0], min = timestr[1];
            var sec = "00";
            if (timestr.length == 3) {
                sec = timestr[2];
            }
            interval = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, min, sec, 0) - now;
            if (interval < 0) {
                interval += 86400000; // try tomorrow.
            }
            console.log("at interval:", interval);
        }
        if (interval <= 0)
            interval = 1000;

        this._interval = interval;
        this._at = at;
        this.filterString = 'interval-' + this._interval + this._at;
        this._timeout = -1;
    },

    _doOpen: function() {
        if (this._at != "") {
            var atCallback = function() {
                var event = { at: this._at, ts: new Date };
                console.log('Emitting timer(at) event', event);
                this.emitEvent(event);
                this._interval = 86400000; // same time tomorrow.
                this._timeout = setTimeout(atCallback.bind(this), this._interval);
            };
            this._timeout = setTimeout(atCallback.bind(this), this._interval);
        } else {
            this._timeout = setInterval(function() {
                var event = { interval: this._interval, ts: new Date };
                console.log('Emitting timer event', event);
                this.emitEvent(event);
            }.bind(this), this._interval);
        }
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
