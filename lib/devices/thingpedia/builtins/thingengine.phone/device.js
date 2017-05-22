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
const Call = require('./call');
const CallEmergency = require('./call_emergency');
const GetGps = require('./get_gps');
const Gps = require('./gps');
const Notify = require('./notify');
const ReceiveSms = require('./receive_sms');
const SendSms = require('./send_sms');
const SetRinger = require('./set_ringer');

// The phone running this instance of ThingEngine, and its
// phone specific channels (like sms and popup notifications)
module.exports = new Tp.DeviceClass({
    Name: 'ThingEnginePhoneDevice',

    _init: function(engine, state) {
        this.parent(engine, state);

        // This is a built-in device so we're allowed some
        // "friendly" API access
        this._tierManager = engine.tiers;

        this.uniqueId = 'org.thingpedia.builtin.thingengine.phone';

        this.name = this.engine._("Phone");
        this.description = this.engine._("Access your phone capabilities from Almond.");
    },

    get ownerTier() {
        return Tp.Tier.PHONE;
    },

    checkAvailable: function() {
        if (Tp.Tier.PHONE === this._tierManager.ownTier)
            return Tp.Availability.AVAILABLE;
        else
            return (this._tierManager.isConnected(Tp.Tier.PHONE) ?
                    Tp.Availability.AVAILABLE :
                    Tp.Availability.OWNER_UNAVAILABLE);
    },

    getTriggerClass(id) {
        switch(id) {
        case 'gps':
            return Gps;
        case 'receive_sms':
            return ReceiveSms;
        default:
            throw new TypeError('Invalid channel ' + id);
        }
    },

    getQueryClass(id) {
        switch(id) {
        case 'get_gps':
            return GetGps;
        default:
            throw new TypeError('Invalid channel ' + id);
        }
    },

    getActionClass(id) {
        switch(id) {
        case 'call':
            return Call;
        case 'call_emergency':
            return CallEmergency;
        case 'notify':
            return Notify;
        case 'set_ringer':
            return SetRinger;
        case 'send_sms':
            return SendSms;
        default:
            throw new TypeError('Invalid channel ' + id);
        }
    }
});
