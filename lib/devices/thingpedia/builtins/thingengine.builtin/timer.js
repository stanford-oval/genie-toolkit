// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//                Jiwon Seo <jiwon@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

module.exports = new Tp.ChannelClass({
    Name: 'TimerChannel',
    Extends: Tp.PollingTrigger,

    _init: function(engine, device, params) {
        this.parent();

        this.interval = params[0];
        if (typeof this.interval !== 'number')
            throw new Error('Missing or invalid parameter for @$timer');
        this.filterString = 'interval-' + this.interval;
    },

    formatEvent(event) {
        var interval = event[0];

        return "Timer Elapsed";
    },

    _onTick: function() {
        var event = [this.interval];
        console.log('Emitting timer event', event);
        this.emitEvent(event);
    },
});
