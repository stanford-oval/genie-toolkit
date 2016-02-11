// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//                Jiwon Seo <jiwon@cs.stanford.edu>
//
// See COPYING for details

const Tp = require('thingpedia');

module.exports = new Tp.ChannelClass({
    Name: 'AtTimerChannel',

    _init: function(engine, device, params) {
        this.parent();

        if (params.length !== 1 ||
            !params[0].isString)
            throw new Error('Invalid @$at parameters');

        var at = params[0].value;
        this._at = at;

        var now = new Date;
        var timestr = at.split(':');
        var hour = timestr[0], min = timestr[1];
        var sec = "00";
        if (timestr.length == 3) {
            sec = timestr[2];
        }
        interval = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, min, sec, 0) - now;
        if (interval < 0)
            interval += 86400000; // try tomorrow.

        this._interval = interval;
        this.filterString = 'at-' + at;
    },

    _doOpen: function() {
        var atCallback = function() {
            var event = [this._at];

            console.log('Emitting timer(at) event', event);
            this.emitEvent(event);
            this.emitEvent(null);

            this._interval = 86400000; // same time tomorrow.
            this._timeout = setTimeout(atCallback.bind(this), this._interval);
        };
        this._timeout = setTimeout(atCallback.bind(this), this._interval);
        return Q();
    },

    _doClose: function() {
        clearTimeout(this._timeout);
        this._timeout = null;
        return Q();
    },
});
