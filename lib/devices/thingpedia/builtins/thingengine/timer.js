// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//                Jiwon Seo <jiwon@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const Tp = require('thingpedia');

module.exports = new Tp.ChannelClass({
    Name: 'TimerChannel',
    Extends: Tp.PollingTrigger,

    _init: function(engine, device, params) {
        this.parent();

        if (params.length !== 1 ||
            !params[0].isMeasure ||
            params[0].unit !== 'ms')
            throw new Error('Invalid @$timer parameters');

        this.interval = params[0].value;
        this.filterString = 'interval-' + this.interval;
    },

    _onTick: function() {
        var event = [this.interval];
        console.log('Emitting timer event', event);
        this.emitEvent(event);
        return Q();
    },
});
