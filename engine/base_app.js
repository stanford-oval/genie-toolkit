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
    Name: 'BaseApp',
    Abstract: true,
    Extends: events.EventEmitter,

    _init: function(engine) {
        // EventEmitter is a node.js class not a lang class,
        // can't chain up normally
        events.EventEmitter.call(this);

        this._engine = engine;
        this.isRunning = false;
        this._isSupported = undefined;

        // Set this to anything but undefined and your app will
        // be accessible to other apps using 'engine.apps.getSharedApp()
        this.sharedId = undefined;
    },

    get engine() {
        return this._engine;
    },

    get isSupported() {
        if (this._isSupported !== undefined)
            return this._isSupported;

        this._isSupported = this.requiredCapabilities.every(function(cap) {
            return platform.hasCapability(cap);
        });
        return this._isSupported;
    },

    // default implementation runs on all tiers
    // you should rarely need to override this, require a specific capability
    // instead
    get allowedTiers() {
        return [Tier.PHONE, Tier.SERVER, Tier.CLOUD];
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


