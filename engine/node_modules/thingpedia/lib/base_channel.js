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

const RefCounted = require('./ref_counted');

module.exports = new lang.Class({
    Name: 'BaseChannel',
    Abstract: true,
    Extends: RefCounted,

    _init: function() {
        this.parent();

        this._event = null;

        // you must set this to something other than undefined if you're
        // doing something server-side with the params, and it must
        // be a unique string for all channels of the given type
        this.filterString = undefined;

        // don't set this, it is set automatically by ChannelFactory
        this.uniqueId = undefined;
    },

    get event() {
        return this._event;
    },

    // report a change in current event value
    emitEvent: function(object) {
        this._event = object;
        this.emit('data', object);
    },

    // public API
    sendEvent: function(object) {
        throw new Error('sendEvent is not implemented by this channel');
    },
});
