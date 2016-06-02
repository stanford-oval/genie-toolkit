// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');
const Q = require('q');

module.exports = new Tp.ChannelClass({
    Name: 'SabrinaListenChannel',
    RequiredCapabilities: ['assistant'],

    _init: function(engine, device) {
        this.parent();
        this.engine = engine;

        this._inner = null;
        this._listener = this._onMessage.bind(this);
    },

    _onMessage: function(message) {
        this.emitEvent([message]);
    },

    _doOpen: function() {
        this.engine.platform.getCapability('assistant').on('message', this._listener);
        return Q();
    },

    _doClose: function() {
        this.engine.platform.getCapability('assistant').removeListener('message', this._listener);
        return Q();
    },
});
