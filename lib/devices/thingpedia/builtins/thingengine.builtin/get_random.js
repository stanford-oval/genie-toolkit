// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

module.exports = class GetRandomChannel extends Tp.BaseChannel {
    formatEvent(event) {
        var number = event[0];
        return String(number);
    }

    invokeQuery(filters) {
        return [[Math.random()]];
    }
}
