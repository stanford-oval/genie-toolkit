// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const events = require('events');
const lang = require('lang');
const Q = require('q');

module.exports = new lang.Class({
    Name: 'BaseApp',
    Extends: events.EventEmitter,

    _init: function() {
        // EventEmitter is a node.js class not a lang class,
        // can't chain up normally
        events.EventEmitter.call(this);

        this.isRunning = false;
    },

    get isSupported() {
        return this.requiredCapabilities.every(function(cap) {
            return platform.hasCapability(cap);
        });
    },

    // default implementation requires no capabilities
    get requiredCapabilities() {
        return [];
    },

    start: function() {
        throw new Error('Not implemented');
    },

    stop: function() {
        throw new Error('Not implemented');
    }
});


