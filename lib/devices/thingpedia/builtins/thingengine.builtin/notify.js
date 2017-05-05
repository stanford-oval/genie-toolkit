// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

module.exports = new Tp.ChannelClass({
    Name: 'NotifyChannel',
    RequiredCapabilities: ['assistant'],

    sendEvent(event) {
        var assistant = this.engine.platform.getCapability('assistant');
        return assistant.notifyAll([null, null, event[0]]);
    }
});
