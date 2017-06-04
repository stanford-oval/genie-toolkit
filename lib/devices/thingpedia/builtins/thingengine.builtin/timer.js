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

module.exports = class TimerChannel extends Tp.PollingTrigger {
    constructor(engine, device, params) {
        super(engine, device);

        this.interval = params[0];
        if (typeof this.interval !== 'number' || isNaN(params[0]))
            throw new Error('Missing or invalid parameter for @$timer');
        this.filterString = 'interval-' + this.interval;
    }

    formatEvent(event) {
        var interval = event[0];

        return this.engine._("Timer Elapsed");
    }

    _onTick() {
        var event = [this.interval];
        console.log('Emitting timer event', event);
        this.emitEvent(event);
    }
}
