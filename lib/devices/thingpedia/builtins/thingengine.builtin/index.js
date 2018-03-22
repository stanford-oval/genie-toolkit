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

    // Note: subscribe, history and sequence are not implemented
    // because they don't really make sense for these queries
    get_get_date() {
        return [{ date: new Date }];
    }
    get_get_time() {
        return [{ time: new Date }];
    }
    get_get_random_between({ low, high }) {
        return [{ number: Math.round(low + (Math.random() * (high - low))) }];
    }
    get_get_commands({ device }) {
        return this.engine.thingpedia.getExamplesByKinds([String(device)]).then((examples) => examples.map((ex) => {
            return { program: new TT.Builtin.ExampleProgram(ex) };
        }));
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
        conversation.interactiveConfigure(String(args.device));
    }
    do_discover(args, env) {
        var conversation = env.app.getConversation();
        if (!conversation)
            throw new Error(this.engine._("User not available"));
        // run it asynchronously, or we'll deadlock
        conversation.interactiveConfigure(null);
    }
    do_open_url({ url }) {
        let cap = this.engine.platform.getCapability('app-launcher');
        if (!cap)
            throw new Error(this.engine._("Opening files is not implemented in this Almond"));
        return cap.launchURL(String(url));
    }
};
