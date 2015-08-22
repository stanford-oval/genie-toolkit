// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

require('./polyfill');

const Q = require('q');
const lang = require('lang');

const AppFactory = require('./app_factory');
const ChannelFactory = require('./channel_factory');
const DeviceFactory = require('./device_factory');
const DeviceDatabase = require('./db/devices');
const TierManager = require('./tier_manager');

const Engine = new lang.Class({
    Name: 'Engine',

    _init: function(apps, devicesql) {
        // constructor

        this._tiers = new TierManager();
        this._devices = new DeviceDatabase(devicesql, this._tiers,
                                           new DeviceFactory(this));
        this._channels = new ChannelFactory(this, this._tiers);
        this._apps = apps;
        apps.setFactory(new AppFactory(this));
        this._running = false;
    },

    get channels() {
        return this._channels;
    },

    get devices() {
        return this._devices;
    },

    get apps() {
        return this._apps;
    },

    // Run sequential DB initialization (downloading any app code if needed)
    open: function() {
        return this._tiers.open()
            .then(function() {
                this._channels.load()
            }.bind(this))
            .then(function() {
                return this._devices.load();
            }.bind(this))
            .then(function() {
                return this._apps.load();
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

        this._running = true;
        var apps = this._apps.getSupportedApps();
        return Q.all(apps.map(function(a) {
            return a.start().then(function() {
                a.isRunning = true;
            }).timeout(30000, 'Timed out').catch(function(e) {
                console.error('App failed to start: ' + e);
            });
        })).then(function() {
            if (!this._running)
                return;

            return Q.Promise(function(callback, errback) {
                if (!this._running) {
                    return callback();
                }

                this._stopCallback = callback;
                apps.forEach(function(a) {
                    if (!a.isRunning)
                        return;

                    a.on('fatal', function(e) {
                        console.error('Fatal error ' + e + ' from app, dying gracefully');
                        errback(e);
                    });
                });
            }.bind(this));
        }.bind(this)).then(function() {
            return Q.all(apps.map(function(a) {
                return a.stop().then(function() {
                    a.isRunning = false;
                }).timeout(30000, 'Timed out').catch(function(e) {
                    console.error('App failed to stop: ' + e);
                });
            }));
        });
    },

    // Stop any rule execution at the next available moment
    // This will cause the run() promise to be fulfilled
    stop: function() {
        console.log('Engine stopped');
        this._running = false;
        if (this._stopCallback)
            this._stopCallback();
    },

    // Run any sequential closing operation on the engine
    // (such as saving databases)
    // Will not be called if start() fails
    //
    // It can be called multiple times, in which case it has
    // no effect
    close: function() {
        return this._tiers.close()
            .then(function() {
                return this._devices.save()
            }.bind(this))
            .then(function() {
                return this._apps.save();
            }.bind(this))
            .then(function() {
                console.log('Engine closed');
            });
    }
});

module.exports = Engine;
