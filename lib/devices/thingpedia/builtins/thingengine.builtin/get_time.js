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
    Name: 'GetTimeChannel',

    formatEvent(event) {
        var date = event[0];

        return "Current time is %s".format(date.toLocaleString());
    },

    invokeQuery(filters) {
        return [[new Date]];
    }
});
