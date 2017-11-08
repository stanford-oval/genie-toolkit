// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

module.exports = class NotifyChannel extends Tp.BaseChannel {
    static get requiredCapabilities() {
        return ['assistant'];
    }

    sendEvent(event, env) {
        return env.say(event[0]);
    }
}
