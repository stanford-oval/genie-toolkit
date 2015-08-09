// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const RuleDatabase = new lang.Class({
    Name: 'RuleDatabase',

    _init: function(root) {
        this._root = root;
    },

    load: function() {
        // load the rule db from... somewhere

        // make sure we return a promise or stuff
        // goes boom
        return Q(true);
    },

    getAllRules: function() {
        return [];
    }
});

const DeviceDatabase = new lang.Class({
    Name: 'DeviceDatabase',

    _init: function() {
        // FIXME: use Map when node supports it
        this._devices = {};
        this._factories = [];
    },

    load: function() {
        // load the device db from... somewhere
        return Q(true);
    },

    save: function() {
        // save the device db... somewhere
    },

    registerFactory: function(factory) {
        this._factories.push(factory);
    },

    storeDevice: function(id, device) {
        this._devices[id] = device;
    },

    getDevice: function(id) {
        if (id in this._devices)
            return this._devices[id];

        for (var i = 0; i < this._factories.length; i++) {
            var factory = this._factories[i];
            try {
                this._devices[id] = factory.createDevice(id);
                return this._devices[id];
            } catch(e) {
            }
        }

        throw new Error('Unknown device ' + id);
    }
});

module.exports = {
    RuleDatabase: RuleDatabase,
    DeviceDatabase: DeviceDatabase
};
