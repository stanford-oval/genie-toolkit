// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const events = require('events');
const Q = require('q');
const lang = require('lang');

// An event source is an object capable of returning the promise
// of an event, happening at some point in the future
exports.EventSource = new lang.Class({
    Name: 'EventSource',
    Extends: events.EventEmitter,
    Abstract: true,

    _init: function() {
        events.EventEmitter.call(this);
        this._event = null;
    },

    get currentEvent: function() {
        return this._event;
    },

    // Run any pre-mainloop code
    enable: function() {
        return Q();
    },

    // Run any post-mainloop code
    disable: function() {
        return Q();
    },

    emitEvent: function(event) {
        this._event = event;
        this.emit('event', event);
    },
});

// An event source that continously signals every timeout milliseconds
exports.TimeoutEventSource = new lang.Class({
    Name: 'TimeoutEventSource',
    Extends: exports.EventSource,

    _init: function(timeout) {
        this.parent();
        this._timeout = timeout;
        this._interval = -1;
    },

    enable: function() {
        this._interval = setInterval(function() {
            this.emitEvent(new Date);
        }.bind(this), this._timeout);
    },

    disable: function() {
        clearInterval(this._interval);
        this._interval = -1;
    },
});
