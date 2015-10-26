// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const lang = require('lang');

const BaseDevice = require('../../base_device');

// An abstraction for a named distributed database on top of
// of a messaging platform
//
// Every subscriber to the distributed database has read
// access, but write access is granted only to the owner of
// each tuple
// Tuples are keyed by owner (which is an opaque ID that depends
// on the implementation)
const DistributedDatabaseDevice = new lang.Class({
    Name: 'DistributedDatabaseDevice',
    Extends: BaseDevice,

    _init: function(engine, state) {
        this.parent(engine, state);
    },

    // The opaque token used by the messaging platform to identify
    // the distributed database feed
    get feedId() {
        return this.state.feedId;
    },

    checkAvailable: function() {
        if (platform.hasCapability('messaging'))
            return BaseDevice.Availability.AVAILABLE;
        else
            return BaseDevice.Availability.UNAVAILABLE;
    },

    open: function() {
    },

    close: function() {
    },

    selectCurrent: function(filters) {
    },

    startWatch: function(filters) {
    },

    stopWatch: function(filters) {
    },

    replace: function(tuple) {
    },

    delete: function(tuple) {
    },
});
