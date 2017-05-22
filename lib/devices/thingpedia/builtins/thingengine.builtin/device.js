// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

// preload channels for the benefit of browserify
const AtTimer = require('./at');
const DebugLog = require('./debug_log');
const GetDate = require('./get_date');
const GetRandom = require('./get_random');
const GetRandBetween = require('./get_random_between');
const GetTime = require('./get_time');
const Notify = require('./notify');
const Timer = require('./timer');

// A placeholder object for builtin triggers/queries/actions that
// don't have any better place to live, such as those related to
// time
module.exports = new Tp.DeviceClass({
    Name: 'ThingEngineDevice',

    _init(engine, state) {
        this.parent(engine, state);

        this.isTransient = true;
        this.uniqueId = 'thingengine-own-global';
        this.name = this.engine._("Miscellaneous Interfaces");
        this.description = this.engine._("Time, randomness and other non-device specific things.");
    },

    get ownerTier() {
        // this pseudo-device does not live anywhere specifically
        return Tp.Tier.GLOBAL;
    },

    checkAvailable() {
        return Tp.Availability.AVAILABLE;
    },

    getTriggerClass(id) {
        switch(id) {
        case 'at':
            return AtTimer;
        case 'timer':
            return Timer;
        default:
            throw new TypeError('Invalid channel ' + id);
        }
    },

    getQueryClass(id) {
        switch(id) {
        case 'get_date':
            return GetDate;
        case 'get_time':
            return GetTime;
        case 'get_random':
            return GetRandom;
        case 'get_random_between':
            return GetRandBetween;
        default:
            throw new TypeError('Invalid channel ' + id);
        }
    },

    getActionClass(id) {
        switch(id) {
        case 'debug_log':
            return DebugLog;
        case 'notify':
            return Notify;
        default:
            throw new TypeError('Invalid channel ' + id);
        }
    }
});
