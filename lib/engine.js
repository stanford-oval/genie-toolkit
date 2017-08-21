// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015-2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

// adds String.prototype.format(), for compat with existing Thingpedia code
require('./polyfill');

const Q = require('q');
const path = require('path');
const fs = require('fs');
const ThingTalk = require('thingtalk');

const DeviceDatabase = require('./devices/database');
const DeviceFactory = require('./devices/thingpedia/factory');
const ThingpediaHttpClient = require('./devices/thingpedia/http_client');
const ChannelFactory = require('./devices/channel_factory');
const ProxyManager = require('./tiers/proxy');
const TierManager = require('./tiers/tier_manager');
const PairedEngineManager = require('./tiers/paired');
const Statistics = require('./stats');

const Config = require('./config');

const sqlite = require('./db/sqlite');

module.exports = class Engine {
    constructor(platform, options = {}) {
        // constructor

        this._platform = platform;
        this._initGettext();

        var hasApps = platform.hasFeature('apps');
        var hasMessaging = platform.hasFeature('messaging');
        var hasDiscovery = platform.hasFeature('discovery');
        var hasML = platform.hasFeature('ml');

        // tiers and devices are always enabled
        this._tiers = new TierManager(platform);
        this._stats = new Statistics(platform);

        this._modules = [];

        if (platform.hasCapability('thingpedia-client'))
            this._thingpedia = platform.getCapability('thingpedia-client');
        else
            this._thingpedia = new ThingpediaHttpClient(platform, options.thingpediaUrl || Config.THINGPEDIA_URL);

        if (hasApps) {
            this._schemas = new ThingTalk.SchemaRetriever(this._thingpedia);
        } else {
            this._schemas = null;
        }
        var deviceFactory = new DeviceFactory(this, this._thingpedia);
        this._devices = new DeviceDatabase(platform, this._tiers,
                                           deviceFactory, this._schemas);
        this._tiers.devices = this._devices;
        this._channels = new ChannelFactory(this, this._tiers, this._devices);

        this._proxies = new ProxyManager(this._tiers, this._channels, this._devices, this._messaging);
        this._channels.proxyManager = this._proxies;

        // in loading order
        this._modules = [this._stats,
                         this._tiers,
                         this._devices,
                         new PairedEngineManager(platform, this._devices, this._tiers),
                         this._channels];

        if (hasMessaging) {
            var MessagingDeviceManager = require('./messaging/device_manager');
            this._messaging = new MessagingDeviceManager(this._devices);
            this._modules.push(this._messaging);
        } else {
            this._messaging = null;
        }
        if (hasApps) {
            var AppDatabase = require('./apps/database');
            this._appdb = new AppDatabase(this);
            this._modules.push(this._appdb);
        } else {
            this._appdb = null;
        }
        if (hasApps) {
            var AppRunner = require('./apps/runner');
            this._apprunner = new AppRunner(this._appdb);
            this._modules.push(this._apprunner);
        }
        if (hasDiscovery) {
            var Discovery = require('thingpedia-discovery');
            this._discovery = new Discovery.Client(platform, this._devices, this._thingpedia);
            this._modules.push(this._discovery);
        } else {
            this._discovery = null;
        }
        if (hasMessaging && hasApps) {
            var PermissionManager = require('./permissions/permission_manager');
            var RemoteExecutor = require('./permissions/remote_executor');
            var PermissionControlResponder = require('./messaging/permission_control_responder');

            var permissionManager = new PermissionManager(this._platform, this._messaging, this._schemas);
            var executor = new RemoteExecutor(this, permissionManager);
            this._remote = new PermissionControlResponder(executor, this._messaging, this._tiers, this._devices);
            this._modules.push(this._remote);
        }
        var MachineLearner = require('./ml');
        this._ml = new MachineLearner(platform, hasML);
        this._modules.push(this._ml);

        this._running = false;
        this._stopCallback = null;
        this._fatalCallback = null;
    }

    get platform() {
        return this._platform;
    }

    get stats() {
        return this._stats;
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

    get channels() {
        return this._channels;
    }

    get devices() {
        return this._devices;
    }

    get thingpedia() {
        return this._thingpedia;
    }

    get schemas() {
        return this._schemas;
    }

    get apps() {
        return this._appdb;
    }

    get discovery() {
        return this._discovery;
    }

    get ml() {
        return this._ml;
    }

    get remote() {
        return this._remote;
    }

    _initGettext() {
        const gettext = this.platform.getCapability('gettext');
        this.gettext = function(string) {
            return gettext.dgettext('thingengine-core', string);
        };
        this.ngettext = function(msg, msgplural, count) {
            return gettext.dngettext('thingengine-core', msg, msgplural, count);
        }
        this.pgettext = function(msgctx, msg) {
            return gettext.dpgettext('thingengine-core', msgctx, msg);
        }
        this._ = this.gettext;
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
        return sqlite.ensureSchema(this.platform).then(() => {
            return this._openSequential(this._modules);
        }).then(() => {
            console.log('Engine started');
        });
    }

    // Run any sequential closing operation on the engine
    // (such as saving databases)
    // Will not be called if start() fails
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
module.exports.prototype.$rpcMethods = ['get devices', 'get apps', 'get messaging'];
