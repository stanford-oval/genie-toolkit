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
const Say = require('./say');
const Timer = require('./timer');

class EasterEggAction extends Tp.BaseChannel {
    sendEvent(event, env) {
        var msg;
        switch (this.name) {
        case 'hello':
            msg = this.engine._("Hi!");
            break;
        case 'cool':
            msg = this.engine._("I know, right?");
            break;
        case 'sorry':
            msg = this.engine._("No need to be sorry.");
            break;
        case 'thank_you':
            msg = this.engine._("At your service.");
            break;
        }
        return env.say(msg);
    }
}

class DiscoveryAction extends Tp.BaseChannel {
    static get requiredCapabilities() {
        return ['assistant'];
    }

    sendEvent(event, env) {
        var kind;
        if (event.length === 0)
            kind = null;
        else
            kind = event[0];
        var conversation = env.getConversation();
        if (!conversation)
            throw new Error(this.engine._("User not available"));
        return conversation.interactiveConfigure([kind]);
    }
}

// A placeholder object for builtin triggers/queries/actions that
// don't have any better place to live, such as those related to
// time
module.exports = class MiscellaneousDevice extends Tp.BaseDevice {
    constructor(engine, state) {
        super(engine, state);

        this.isTransient = true;
        this.uniqueId = 'thingengine-own-global';
        this.name = this.engine._("Miscellaneous Interfaces");
        this.description = this.engine._("Time, randomness and other non-device specific things.");
    }

    get ownerTier() {
        // this pseudo-device does not live anywhere specifically
        return Tp.Tier.GLOBAL;
    }

    checkAvailable() {
        return Tp.Availability.AVAILABLE;
    }

    getTriggerClass(id) {
        switch(id) {
        case 'at':
            return AtTimer;
        case 'timer':
            return Timer;
        default:
            throw new TypeError('Invalid channel ' + id);
        }
    }

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
    }

    getActionClass(id) {
        switch(id) {
        case 'debug_log':
            return DebugLog;
        case 'notify':
        case 'say':
            return Say;
        case 'hello':
        case 'cool':
        case 'sorry':
        case 'thank_you':
            return EasterEggAction;
        case 'configure':
        case 'discover':
            return DiscoveryAction;
        default:
            throw new TypeError('Invalid channel ' + id);
        }
    }
}
