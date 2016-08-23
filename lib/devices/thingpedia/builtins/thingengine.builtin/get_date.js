// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

module.exports = new Tp.ChannelClass({
    Name: 'GetDateChannel',

    _init(engine, device) {
        this.parent();
        this.engine = engine;
    },

    formatEvent(event) {
        var date = event[0];

        var locale = this.engine.platform.locale;
        var timezone = this.engine.platform.timezone;
        return this.engine._("Current date is %s").format(date.toLocaleDateString(locale, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: timezone
        }));
    },

    invokeQuery(filters) {
        return [[new Date]];
    }
});
