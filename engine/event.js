// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const lang = require('lang');

// An event source is an object capable of returning the promise
// of an event, happening at some point in the future
exports.EventSource = new lang.Class({
    Name: 'EventSource',
    Abstract: true,

    _init: function() {
    },

    // Run any pre-mainloop code
    enable: function() {
        return Q(true);
    },

    // Run any post-mainloop code
    disable: function() {
        return Q(true);
    },

    // return a promise that will be fulfilled when the event next happens
    getNext: function() {
        throw new Error('Unimplemented!');
    }
});

// An EventQueue is an EventSource that will return all events from all
// children event sources
exports.EventQueue = new lang.Class({
    Name: 'EventQueue',
    Extends: exports.EventSource,

    _init: function(sources) {
        this._children = sources;
        this._reset();
    },

    _reset: function() {
        this._queue = [];
        this._callback = null;
        this._errback = null;
        this._hasNext = new Array(this._children.length);
        for (var i = 0; i < this._children.length; i++)
            this._hasNext[i] = false;
    },

    _kick: function() {
        if (this._queue.length == 0)
            return;

        if (this._callback == null || this._errback == null)
            return;

        this._queue.shift()(this._callback, this._errback);
    },

    _collectPromises: function() {
        for (var i = 0; i < this._children.length; i++) {
            var source = this._children[i];
            if (this._hasNext[i])
                continue;
            this._hasNext[i] = true;

            (function() {
                // need this copy to be able to capture in the closure
                // without the next iteration of the loop overwriting it
                var iCopy = i;
                source.getNext().then(function(value) {
                    this._hasNext[iCopy] = false;
                    this._queue.push(function(callback, errback) {
                        callback(value);
                    });
                    this._kick();
                }.bind(this), function(error) {
                    this._hasNext[iCopy] = false;
                    this._queue.push(function(callback, errback) {
                        errback(error);
                    })
                    this._kick();
                }.bind(this));
            }.bind(this))();
        }
    },

    enable: function() {
        console.log('Enabling EventQueue');
        return Q.all(this._children.map(function(source) {
            return source.enable();
        }));
    },

    disable: function() {
        console.log('Disabling EventQueue');
        this._reset();
        return Q.all(this._children.map(function(source) {
            return source.disable();
        }));
    },

    getNext: function() {
        if (this._queue.length > 0) {
            return Q.Promise(this._queue.shift());
        } else {
            this._collectPromises();

            return Q.Promise(function(callback, errback) {
                if (this._queue.length > 0) {
                    return this._queue.shift()(callback, errback);
                } else {
                    this._callback = callback;
                    this._errback = errback;
                }
            }.bind(this));
        }
    }
});

// An event source that continously signals every timeout milliseconds
exports.TimeoutEventSource = new lang.Class({
    Name: 'TimeoutEventSource',
    Extends: exports.EventSource,

    _init: function(timeout) {
        this.parent();
        this._timeout = timeout;
    },

    getNext: function() {
        return Q.delay(this._timeout);
    }
});

// An event source that returns true when signalled from outside
exports.FlagEventSource = new lang.Class({
    Name: 'FlagEventSource',
    Extends: exports.EventSource,

    _init: function() {
        this.parent();
        this._flagged = false;
        this._flagValue = undefined;
        this._flagError = undefined;
        this._callback = null;
        this._errback = null;
    },

    get flagged() {
        return this._flagged;
    },

    enable: function() {
        return Q(true);
    },

    disable: function() {
        this._flagged = false;
        this._flagValue = undefined;
        this._flagError = undefined;
        this._callback = null;
        this._errback = null;
        return Q(true);
    },

    signalError: function(error) {
        if (this._flagged)
            throw new Error('Source was already flagged');

        this._flagged = true;
        this._flagError = error;
        if (this._errback)
            this._errback(error);
    },

    signal: function(value) {
        if (this._flagged)
            throw new Error('Source was already flagged');

        this._flagged = true;
        this._flagValue = value;
        if (this._callback)
            this._callback(value);
    },

    getNext: function() {
        if (this._flagged) {
            if (this._flagError !== undefined)
                throw this._flagError;
            else
                return Q(this._flagValue);
        } else {
            return Q.Promise(function(callback, errback) {
                if (this._flagged) {
                    if (this._flagError !== undefined)
                        errback(this._flagError);
                    else
                        callback(this._flagValue);
                } else {
                    this._callback = callback;
                    this._errback = errback;
                }
            }.bind(this));
        }
    },
});
