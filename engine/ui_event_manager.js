// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const lang = require('lang');
const fs = require('fs');
const events = require('events');

module.exports = new lang.Class({
    Name: 'UIEventManager',
    Extends: events.EventEmitter,
    $rpcMethods: ['injectUIEvent'],

    _init: function(engine) {
        events.EventEmitter.call(this);

        this.engine = engine;
    },

    injectUIEvent: function(event) {
        console.log('Injecting UI event', event);

        this.emit('event', event);
    },

    start: function() {
        return Q();
    },

    stop: function() {
        return Q();
    },
});
