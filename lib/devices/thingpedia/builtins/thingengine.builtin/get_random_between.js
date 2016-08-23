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
    Name: 'GetRandomBetweenChannel',

    formatEvent(event) {
        var low = event[0];
        var high = event[1];
        var number = event[2];
        return String(number);
    },

    invokeQuery(filters) {
        var low = filters[0];
        var high = filters[1];
        if (low === undefined || high === undefined ||
            low === null || high === null)
            throw new TypeError('Missing required parameters');

        return [[low, high, Math.round(low + (Math.random() * (high - low)))]];
    }
});
