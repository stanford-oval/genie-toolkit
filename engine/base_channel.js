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

const Tier = require('./tier_manager').Tier;

module.exports = new lang.Class({
    Name: 'BaseChannel',
    Abstract: true,
    Extends: events.EventEmitter,

    _init: function() {
        events.EventEmitter.call(this);
        this.setMaxListeners(0);

        this._useCount = 0;
        this._openPromise = null;
        this._closePromise = null;
        this._previousEvent = null;
        this._event = null;

        // you must set this to something other than undefined if you're
        // doing something server-side with the filters, and it must
        // be a unique string for all channels of the given type
        this.filterString = undefined;

        // don't set this, it is set automatically by ChannelFactory
        this.uniqueId = undefined;
    },

    // Open any resources or connections that this channel might
    // require
    _doOpen: function() {
        return Q();
    },

    // Close all resources that were opened in open()
    _doClose: function() {
        return Q();
    },

    // public API handles ref counts for you, so that multiple apps can open your
    // channel and individually close it
    open: function() {
        // if closing, wait to fully close then reopen
        if (this._closePromise) {
            return this._closePromise.then(function() {
                return this.open();
            }.bind(this));
        }

        this._useCount++;
        if (this._useCount == 1) { // first open
            if (this._openPromise)
                throw new Error('bookkeeping error');
            return this._openPromise = this._doOpen().finally(function() {
                this._openPromise = null;
            }.bind(this));
        } else if (this._openPromise) { // opening
            return this._openPromise;
        } else { // opened
            return Q();
        }
    },

    close: function() {
        // if opening, wait to fully open then close
        if (this._openPromise) {
            return this._openPromise.then(function() {
                return this.close();
            }.bind(this));
        }

        this._useCount++;
        if (this._useCount == 0) { // last close
            if (this._closePromise)
                throw new Error('bookkeeping error');
            return this._closePromise = this._doOpen().finally(function() {
                this._closePromise = null;
            }.bind(this));
        } else if (this._closePromise) { // opening
            return this._closePromise;
        } else { // opened
            return Q();
        }
    },

    get event() {
        return this._event;
    },

    get previousEvent() {
        return this._previousEvent;
    },

    // for subclasses
    setPreviousEvent: function(object) {
        this._previousEvent = object;
    },

    setCurrentEvent: function(object) {
        this._event = object;
        this.emit('changed');
    },

    // report a change in current event value
    emitEvent: function(object) {
        // don't call nextTick() here, we don't want to emit a signal or we confuse ChannelStubs
        this._previousEvent = this._event;

        this._event = object;
        this.emit('data', object);
        this.emit('changed', object);
    },

    // report no change in current event value
    // we could emit an event, then let the app executor change code
    // filter it out
    // but it is probably the case that not emitting the event is equivalent,
    // because threshold rules are necessarily disabled and change rules
    // would not see a difference
    // ... i mean provably, not probably ;)
    nextTick: function() {
        this._previousEvent = this._event;
        // don't use this event, it exists only for proxies
        this.emit('next-tick');
    },

    // public API
    sendEvent: function(object) {
        throw new Error('sendEvent is not implemented by this channel');
    },
});
