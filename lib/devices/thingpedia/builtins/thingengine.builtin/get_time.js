// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

module.exports = class GetTimeChannel extends Tp.BaseChannel {
    formatEvent(event, filters, hint, formatter) {
        var date = event[0];
        return this.engine._("Current time is %s").format(formatter.timeToString(date));
    }

    invokeQuery(filters) {
        return [[new Date]];
    }
}
