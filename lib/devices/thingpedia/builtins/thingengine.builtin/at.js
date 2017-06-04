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

module.exports = class AtTimerChannel extends Tp.BaseChannel {
    constructor(engine, device, params) {
        super(engine, device);
        this.engine = engine;

        var at = params[0];
        if (!at)
            throw new Error('Missing required parameter for @$at');
        this._at = at;

        var timestr = at.split(':');
        this._hour = parseInt(timestr[0], 10);
        this._min = parseInt(timestr[1], 10);
        this._sec = 0;
        if (timestr.length == 3)
            this._sec = parseInt(timestr[2], 10);

        this.filterString = 'at-' + at;
    }

    formatEvent(event) {
        var time = event[0];

        return this.engine._("Timer at %s elapsed.").format(time);
    }

    _nextTimeout() {
        var now = new Date;
        var target = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
            this._hour, this._min, this._sec, 0);
        var interval = target.getTime() - now.getTime();

        if (interval < 0)
            interval += 86400000; // try tomorrow

        console.log('At timer to ' + this._at + ': polling again in ' + interval + ' ms');
        return interval;
    }

    _doOpen() {
        var atCallback = function() {
            var event = [this._at];

            console.log('Emitting timer(at) event', event);
            this.emitEvent(event);
            this.emitEvent(null);

            this._timeout = setTimeout(atCallback.bind(this), this._nextTimeout());
        };
        this._timeout = setTimeout(atCallback.bind(this), this._nextTimeout());
    }

    _doClose() {
        clearTimeout(this._timeout);
        this._timeout = null;
    }
}
