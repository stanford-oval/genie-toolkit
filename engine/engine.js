// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const lang = require('lang');

const channel = require('./channel');
const db = require('./db');
const event = require('./event');

const Engine = new lang.Class({
    Name: 'Engine',

    _init: function() {
        // constructor

        this._channels = new channel.ChannelFactory();
        this._devices = new db.DeviceDatabase();
        this._rules = new db.RuleDatabase();

        this._running = false;
        this._stopFlag = new event.FlagEventSource();
    },

    // Run any sequential initialization before starting with
    // the rule loop
    open: function() {
        return this._channels.load()
            .then(function() {
                return this._devices.load();
            }.bind(this))
            .then(function() {
                return this._rules.load();
            }.bind(this))
            .then(function() {
                console.log('Engine started');
            });
    },

    _collectEventSources: function() {
        var sources = [];

        this._rules.getAllRules().forEach(function(rule) {
            sources.concat(rule.getEventSources());
        });

        sources.push(this._stopFlag);
        return sources;
    },

    // Kick start the engine by returning a promise that will
    // run each rule in sequence, forever, without ever being
    // fulfilled until engine.stop() is called
    run: function() {
        console.log('Engine running');

        var sources = this._collectEventSources();
        // For debugging only
        sources.push(new event.TimeoutEventSource(5000));
        var stopFlag = this._stopFlag;
        var queue = new event.EventQueue(sources);

        function loop() {
            return queue.getNext().then(function(event) {
                if (!stopFlag.flagged) {
                    // FINISHME: Run the next iteration of the engine loop!
                    console.log('Engine awaken, running one rule');
                    return loop();
                } else {
                    console.log('Engine stop requested, terminating loop');
                    return Q(true);
                }
            });
        }

        return queue.enable().then(function() {
            return loop();
        }).then(function() {
            return queue.disable();
        });
    },

    // Stop any rule execution at the next available moment
    // This will cause the run() promise to be fulfilled
    stop: function() {
        console.log('Engine stopped');
        this._stopFlag.signal();
    },

    // Run any sequential closing operation on the engine
    // (such as saving databases)
    // Will not be called if start() fails
    //
    // It can be called multiple times, in which case it has
    // no effect
    close: function() {
        console.log('Engine closed');
        return Q(true);
    }
});

module.exports = Engine;
