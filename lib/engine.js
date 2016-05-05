// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015-2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

// adds String.prototype.format(), for compat with existing ThingPedia code
require('./polyfill');

const Q = require('q');

const ThingPediaClient = require('thingpedia-client');
const Discovery = require('thingpedia-discovery');

const AppDatabase = require('./apps/database');
const AppRunner = require('./apps/runner');
const DeviceDatabase = require('./devices/database');
const ChannelFactory = require('./devices/channel_factory');
const SchemaRetriever = require('./devices/schema');
const TierManager = require('./tiers/tier_manager');
const PairedEngineManager = require('./tiers/paired');
const UIManager = require('./ui_manager');
const MessagingDeviceManager = require('./messaging/device_manager');
const MessagingSyncManager = require('./messaging/sync_manager');
const KeywordRegistry = require('./keyword/registry');
const GraphDatabase = require('./graphdb');
const Logger = require('./logger');

module.exports = class Engine {
    constructor(platform) {
        // constructor

        this._platform = platform;
        this._tiers = new TierManager(platform);

        var thingpedia = platform.getCapability('thingpedia-client');

        this._schemas = new SchemaRetriever(thingpedia);
        var deviceFactory = new ThingPediaClient.DeviceFactory(this, thingpedia);
        this._devices = new DeviceDatabase(platform, this._tiers,
                                           deviceFactory, this._schemas);
        this._tiers.devices = this._devices;
        this._messaging = new MessagingDeviceManager(this._devices);
        this._keywords = new KeywordRegistry(platform, this._messaging);
        this._channels = new ChannelFactory(this, this._tiers, this._devices);
        this._appdb = new AppDatabase(this);
        this._apprunner = new AppRunner(this._appdb);
        this._ui = new UIManager(this);
        this._graphdb = new GraphDatabase(platform, this._messaging);

        // in loading order
        this._modules = [this._tiers,
                         this._devices,
                         new PairedEngineManager(platform, this._devices, this._tiers),
                         this._messaging,
                         this._keywords,
                         this._channels,
                         this._apps,
                         this._ui,
                         this._graphdb,
                         new Logger(this._channels),
                         this._apprunner,
                         new MessagingSyncManager(this._messaging),
                         new Discovery.Client(this._devices, thingpedia)];

        this._running = false;
        this._stopCallback = null;
        this._fatalCallback = null;
    }

    get platform() {
        return this._platform;
    }

    get ownTier() {
        return this._tiers.ownTier;
    }

    get tiers() {
        return this._tiers;
    }

    get messaging() {
        return this._messaging;
    }

    get keywords() {
        return this._keywords;
    }

    get channels() {
        return this._channels;
    }

    get devices() {
        return this._devices;
    }

    get schemas() {
        return this._schemas;
    }

    get apps() {
        return this._apps;
    }

    get ui() {
        return this._ui;
    }

    get graphdb() {
        return this._graphdb;
    }

    _openSequential(modules) {
        function open(i) {
            if (i == modules.length)
                return;

            return modules[i].start().then(function() {
                return open(i+1);
            });
        }

        return open(0);
    }

    _closeSequential(modules) {
        function close(i) {
            if (i < 0)
                return Q();

            return modules[i].stop().then(function() {
                return close(i-1);
            });
        }

        return close(modules.length-1);
    }

    // Run sequential initialization
    open() {
        return this._openSequential(this._modules).then(function() {
            console.log('Engine started');
        });
    }

    // Run any sequential closing operation on the engine
    // (such as saving databases)
    // Will not be called if start() fails
    //
    // It can be called multiple times, in which case it has
    // no effect
    close() {
        return this._closeSequential(this._modules).then(function() {
            console.log('Engine closed');
        });
    }

    // Kick start the engine by returning a promise that will
    // run each rule in sequence, forever, without ever being
    // fulfilled until engine.stop() is called
    run() {
        console.log('Engine running');

        this._running = true;

        return Q.Promise(function(callback, errback) {
            if (!this._running) {
                return callback();
            }

            this._stopCallback = callback;
        }.bind(this));
    }

    // Stop any rule execution at the next available moment
    // This will cause the run() promise to be fulfilled
    stop() {
        console.log('Engine stopped');
        this._running = false;
        if (this._stopCallback)
            this._stopCallback();
    }
}
module.exports.prototype.$rpcMethods = ['get devices', 'get schemas', 'get apps',
                                        'get ui', 'get assistant', 'get graphdb',
                                        'get messaging'];
