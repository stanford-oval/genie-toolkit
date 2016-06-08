// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

module.exports = new Tp.DeviceClass({
    Name: 'GraphdbDevice',

    _init: function(engine, state) {
        this.parent(engine, state);

        if (!state.own)
            throw new TypeError('Remote Graphdbs are not yet supported');

        this.uniqueId = 'thingengine-own-graphdb';
    }
});
