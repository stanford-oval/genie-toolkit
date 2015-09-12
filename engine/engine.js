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
const AppDatabase = require('./db/apps');
const ChannelFactory = require('./channel_factory');
const DeviceFactory = require('./device_factory');
const DeviceDatabase = require('./db/devices');
const TierManager = require('./tier_manager');

const Engine = new lang.Class({
    Name: 'Engine',
    $rpcMethods: ['get channels', 'get devices', 'get apps'],

    _init: function() {
        // constructor

        this._tiers = new TierManager();
        this._devices = new DeviceDatabase(this._tiers,
                                           new DeviceFactory(this));
        this._channels = new ChannelFactory(this, this._tiers);
        this._apps = new AppDatabase(this._tiers,
                                     new AppFactory(this));

        this._running = false;
        this._stopCallback = null;
        this._fatalCallback = null;
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

    _startOneApp: function(a) {
        if (!a.isEnabled) {
            console.log('App ' + a.uniqueId  + ' is not enabled');
            return Q();
        }

        return a.start().then(function() {
            a.isRunning = true;
            console.log('App ' + a.uniqueId  + ' started');
        }.bind(this)).timeout(30000, 'Timed out').catch(function(e) {
            console.error('App failed to start: ' + e);
            console.error(e.stack);
        });
    },

    _stopOneApp: function(a) {
        if (!a.isRunning)
            return;

        return a.stop().then(function() {
            a.isRunning = false;
            console.log('App ' + a.uniqueId  + ' stopped');
        }).timeout(30000, 'Timed out').catch(function(e) {
            console.error('App failed to stop: ' + e);
        });
    },

    _onAppChanged: function(a) {
        if (a.isRunning && !a.isEnabled)
            this._stopOneApp(a);
        else if (a.isEnabled && !a.isRunning)
            this._startOneApp(a);
    },

    _startAllApps: function() {
        var apps = this._apps.getAllApps();
        return Q.all(apps.map(this._startOneApp.bind(this)));
    },

    _stopAllApps: function() {
        var apps = this._apps.getAllApps();
        return Q.all(apps.map(this._stopOneApp.bind(this)));
    },

    // Kick start the engine by returning a promise that will
    // run each rule in sequence, forever, without ever being
    // fulfilled until engine.stop() is called
    run: function() {
        console.log('Engine running');

        this._running = true;

        return this._startAllApps()
            .then(function() {
                if (!this._running)
                    return;

                this.apps.on('app-added', this._startOneApp.bind(this));
                this.apps.on('app-removed', this._stopOneApp.bind(this));
                this.apps.on('app-changed', this._onAppChanged.bind(this));

                return Q.Promise(function(callback, errback) {
                    if (!this._running) {
                        return callback();
                    }

                    this._stopCallback = callback;
                }.bind(this));
            }.bind(this))
            .then(function() {
                return this._stopAllApps();
            }.bind(this));
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
