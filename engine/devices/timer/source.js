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
            if (filters[i].isChange) {
                if (filters[i].expr.name !== 'ts')
                    throw new Error('Unknown property ' + filters[i].expr.name);

                var amount;
                if (filters[i].amount !== null)
                    amount = filters[i].amount.value.value;
                else
                    amount = 1000;
                interval = Math.max(interval, amount);
            } else {
                // FIXME
                throw new Error('Threshold filters are not yet implemented for #timer');
            }
        }
        if (interval <= 0)
            throw new Error('Must specify a time change for #timer');

        this._interval = interval;
        this.filterString = 'interval-' + this._interval;
        this._timeout = -1;
    },

    _doOpen: function() {
        this._timeout = setInterval(function() {
            var event = { ts: new Date };
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
