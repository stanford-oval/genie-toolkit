// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');
const TT = require('thingtalk');
const stream = require('stream');

function N_(x) { return x; }

const CANNED_RESPONSES = {
    hello: N_("Hi!"),
    cool: N_("I know, right?"),
    sorry: N_("No need to be sorry."),
    thank_you: N_("At your service.")
};

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

    get_get_date() {
        return [{ date: new Date }];
    }
    get_get_time() {
        return [{ time: new Date }];
    }
    get_get_random_between({ low, high }) {
        low = (low === null || low === undefined) ?  1 : low;
        high = (high === null || high === undefined) ?  6 : high;
        return [{ random: Math.round(low + (Math.random() * (high - low))) }];
    }
    get_canned_reply({ intent }) {
        return [{ text: this.engine._(CANNED_RESPONSES[intent]) }];
    }

    async get_get_gps() {
        let gps = this.engine.platform.getCapability('gps');
        if (gps === null)
            throw new Error(this.engine._("Sorry, I cannot access your location in this version of Almond."));
        const location = await gps.getCurrentLocation();
        if (location) {
            return [{ location: { x: location.longitude, y: location.latitude, display: location.display },
                      altitude: location.altitude,
                      bearing: location.bearing,
                      speed: location.speed }];
        } else {
            return [{ location: { x: 0, y: 0, display: this.engine._("Unknown") },
                      altitude: 0,
                      bearing: 0,
                      speed: 0 }];
        }
    }
    subscribe_get_gps() {
        let gps = this.engine.platform.getCapability('gps');
        if (gps === null)
            throw new Error(this.engine._("Sorry, I cannot access your location in this version of Almond."));
        let gpsstream = new stream.Readable({ objectMode: true, read() {} });

        gps.onlocationchanged = (error, location) => {
            if (error) {
                gpsstream.emit('error', error);
            } else if (location !== null) {
                gpsstream.push({ location: { x: location.longitude, y: location.latitude, display: location.display },
                                 altitude: location.altitude,
                                 bearing: location.bearing,
                                 speed: location.speed });
            }
        };
        gps.start();
        gpsstream.destroy = () => gps.stop();
        return gpsstream;
    }

    async get_get_commands({ device }) {
        const dataset = await this.engine.thingpedia.getExamplesByKinds([String(device)]);
        const parsed = await TT.Grammar.parseAndTypecheck(dataset, this.engine.schemas, false);

        return parsed.datasets[0].examples.map((ex) => {
            return { program: ex };
        });
    }

    do_debug_log(args) {
        console.log('DEBUG:', args.message);
    }
    do_say(args, env) {
        return env.say(args.message);
    }
    do_configure(args, env) {
        var conversation = env.app.getConversation();
        if (!conversation)
            throw new Error(this.engine._("User not available"));
        // run it asynchronously, or we'll deadlock
        Promise.resolve(conversation.interactiveConfigure(String(args.device))).catch((err) => {
            // the error has already been logged by Almond, and the user has been informed
        });
    }
    do_discover(args, env) {
        var conversation = env.app.getConversation();
        if (!conversation)
            throw new Error(this.engine._("User not available"));
        // run it asynchronously, or we'll deadlock
        Promise.resolve(conversation.interactiveConfigure(null)).catch((err) => {
            // the error has already been logged by Almond, and the user has been informed
        });
    }
    do_open_url({ url }) {
        let cap = this.engine.platform.getCapability('app-launcher');
        if (!cap)
            throw new Error(this.engine._("Opening files is not implemented in this Almond"));
        return cap.launchURL(String(url));
    }
};
