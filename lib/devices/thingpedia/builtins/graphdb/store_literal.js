// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

const Util = require('./util');

module.exports = new Tp.ChannelClass({
    Name: 'StoreTripleChannel',

    _init: function(engine, device) {
        this.parent();

        this.engine = engine;
        this.device = device;
    },

    sendEvent: function(event) {
        var subject = Util.normalizeResource(event[0]);
        var predicate = Util.normalizeResource(event[1]);
        var object = event[2]; // FIXME normalize literal
        this.engine.graphdb.local.put([{ subject: subject, predicate: predicate, object: object }]);
    }
})
