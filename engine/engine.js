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

const AppDatabase = require('./db/apps');
const ChannelFactory = require('./channel_factory');
const DeviceFactory = require('./devices/factory');
const DeviceDatabase = require('./db/devices');
const TierManager = require('./tier_manager');
const DeviceManager = require('./devices/manager');
const ManualQueryRunner = require('./rpc_query_runner');
const UIManager = require('./ui_manager');
const MessagingDeviceManager = require('./messaging/device_manager');
const KeywordRegistry = require('./db/keyword');
const MessagingSyncManager = require('./messaging/sync_manager');
const AssistantManager = require('./assistant_manager');

const Engine = new lang.Class({
    Name: 'Engine',
    $rpcMethods: ['get channels', 'get devices', 'get apps', 'get ui', 'get assistant',
                  'get messaging', 'getQueryRunner'],

    _init: function() {
        // constructor

        this._tiers = new TierManager();
        var deviceFactory = new DeviceFactory(this);
        this._devices = new DeviceDatabase(this._tiers, deviceFactory);
        this._messaging = new MessagingDeviceManager(this._devices);
        this._keywords = new KeywordRegistry(this._tiers, this._messaging);
        this._channels = new ChannelFactory(this, this._tiers, this._devices);
        this._apps = new AppDatabase(this, this._tiers);
        this._ui = new UIManager(this);
        this._assistant = AssistantManager.create(this);

        // in loading order
        this._modules = [this._tiers,
                         this._devices,
                         new DeviceManager(this._devices, this._tiers),
                         this._messaging,
                         this._keywords,
                         this._channels,
                         this._apps,
                         this._ui,
                         this._assistant];
        // to be started after the apps
        this._lateModules = [new MessagingSyncManager(this._messaging)];

        this._running = false;
        this._stopCallback = null;
        this._fatalCallback = null;
    },

    get ownTier() {
        return this._tiers.ownTier;
    },

    get tiers() {
        return this._tiers;
    },

    get messaging() {
        return this._messaging;
    },

    get keywords() {
        return this._keywords;
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

    get ui() {
        return this._ui;
    },

    get assistant() {
        return this._assistant;
    },

    getQueryRunner: function() {
        return new ManualQueryRunner(this);
    },

    _openSequential: function(modules) {
        function open(i) {
            if (i == modules.length)
                return;

            return modules[i].start().then(function() {
                return open(i+1);
            });
        }

        return open(0);
    },

    _closeSequential: function(modules) {
        function close(i) {
            if (i < 0)
                return Q();

            return modules[i].stop().then(function() {
                return close(i-1);
            });
        }

        return close(modules.length-1);
    },

    // Run sequential initialization
    open: function() {
        return this._openSequential(this._modules).then(function() {
            console.log('Engine started');
        });
    },

    // Run any sequential closing operation on the engine
    // (such as saving databases)
    // Will not be called if start() fails
    //
    // It can be called multiple times, in which case it has
    // no effect
    close: function() {
        return this._closeSequential(this._modules).then(function() {
            console.log('Engine closed');
        });
    },

    _startOneApp: function(a) {
        if (!a.isEnabled) {
            console.log('App ' + a.uniqueId  + ' is not enabled');
            return Q();
        }

        return a.start().then(function() {
            a.isRunning = true;
            console.log('App ' + a.uniqueId  + ' started');
        }).timeout(30000, 'Timed out').catch(function(e) {
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
            this._stopOneApp(a).done();
        else if (a.isEnabled && !a.isRunning)
            this._startOneApp(a).done();
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
                return this._openSequential(this._lateModules);
            }.bind(this)).then(function() {
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
                return this._closeSequential(this._lateModules);
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
});

module.exports = Engine;
