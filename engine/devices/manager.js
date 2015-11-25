// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const events = require('events');
const fs = require('fs');
const lang = require('lang');

const GlobalDeviceManager = require('./global');
const PairedEngineManager = require('./paired');

// a meta-module that collects all modules that deal with discovering,
// creating and maintaining devices (ie, things)

module.exports = new lang.Class({
    Name: 'DeviceManager',

    _init: function(db, tierManager) {
        // in loading order
        this._modules = [new GlobalDeviceManager(db),
                         new PairedEngineManager(db, tierManager)];
    },

    _startSequential: function(modules) {
        function start(i) {
            if (i == modules.length)
                return;

            return modules[i].start().then(function() {
                return start(i+1);
            });
        }

        return start(0);
    },

    _stopSequential: function(modules) {
        function stop(i) {
            if (i < 0)
                return Q();

            return modules[i].stop().then(function() {
                return stop(i-1);
            });
        }

        return stop(modules.length-1);
    },

    start: function() {
        return this._startSequential(this._modules);
    },

    stop: function() {
        return this._stopSequential(this._modules);
    },
});
