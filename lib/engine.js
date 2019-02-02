// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015-2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

// adds String.prototype.format(), for compat with existing Thingpedia code
require('./polyfill');

const ThingTalk = require('thingtalk');
const TpClient = require('thingpedia-client');

const DeviceDatabase = require('./devices/database');
const DeviceFactory = TpClient.DeviceFactory;
const ThingpediaHttpClient = TpClient.HttpClient;
const TierManager = require('./tiers/tier_manager');
const PairedEngineManager = require('./tiers/paired');
const Builtins = require('./devices/builtins');

const Config = require('./config');

const sqlite = require('./db/sqlite');
const Memory = require('./db/memory');

// FINISHME
class DummyGroupDelegate {
    getGroups(principal) {
        return Promise.resolve([]);
    }
}

module.exports = class Engine {
    constructor(platform, options = {}) {
        // constructor

        this._platform = platform;
        this._initGettext();

        const hasApps = platform.hasFeature('apps');
        const hasMessaging = platform.hasFeature('messaging');
        const hasMemory = platform.hasFeature('memory');
        const hasDiscovery = platform.hasFeature('discovery');
        const hasPermissions = platform.hasFeature('permissions');
        const hasRemote = platform.hasFeature('remote');

        // tiers and devices are always enabled
        this._tiers = new TierManager(platform);

        this._modules = [];

        if (platform.hasCapability('thingpedia-client'))
            this._thingpedia = platform.getCapability('thingpedia-client');
        else
            this._thingpedia = new ThingpediaHttpClient(platform, options.thingpediaUrl || Config.THINGPEDIA_URL);

        if (hasMemory)
            this._memory = new Memory(platform, this);
        else
            this._memory = null;

        if (hasApps || hasPermissions)
            this._schemas = new ThingTalk.SchemaRetriever(this._thingpedia, this._memory);
        else
            this._schemas = null;
        var deviceFactory = new DeviceFactory(this, this._thingpedia, Builtins);
        this._devices = new DeviceDatabase(platform, this._tiers,
                                           deviceFactory, this._schemas);
        this._tiers.devices = this._devices;

        // in loading order
        this._modules = [this._tiers,
                         this._devices,
                         new PairedEngineManager(platform, this._devices, this._tiers)];
        if (hasMemory)
            this._modules.push(this._memory);

        if (hasMessaging) {
            const MessagingDeviceManager = require('./messaging/device_manager');
            this._messaging = new MessagingDeviceManager(platform, this._devices);
            this._modules.push(this._messaging);
        } else {
            this._messaging = null;
        }
        if (hasApps) {
            const AppDatabase = require('./apps/database');
            this._appdb = new AppDatabase(this);
            this._modules.push(this._appdb);
            const AppRunner = require('./apps/runner');
            let apprunner = new AppRunner(this._appdb);
            this._modules.push(apprunner);
        } else {
            this._appdb = null;
        }
        if (hasDiscovery) {
            const Discovery = require('thingpedia-discovery');
            this._discovery = new Discovery.Client(platform, this._devices, this._thingpedia);
            this._modules.push(this._discovery);
        } else {
            this._discovery = null;
        }
        if (hasPermissions) {
            const PermissionManager = require('./permissions/permission_manager');

            let groupDelegate;
            if (platform.hasCapability('permission-groups'))
                groupDelegate = platform.getCapability('permission-groups');
            else
                groupDelegate = new DummyGroupDelegate();
            this._permissionManager = new PermissionManager(this._platform, groupDelegate, this._schemas);
            this._modules.push(this._permissionManager);
        } else {
            this._permissionManager = null;
        }
        if (hasRemote) {
            if (!hasMessaging || !hasPermissions || !hasApps)
                throw new TypeError('Remote execution requires messaging, permission management and apps');
            const CommunicationManager = require('./messaging/communication_manager');
            this._remote = new CommunicationManager(this._platform, this._permissionManager, this._messaging, this._tiers, this._devices, this._schemas);
            this._modules.push(this._remote);
        } else {
            this._remote = null;
        }

        this._running = false;
        this._stopCallback = null;
        this._fatalCallback = null;
    }

    get platform() {
        return this._platform;
    }

    get memory() {
        return this._memory;
    }

    get ownTier() {
        return this._tiers.ownTier;
    }

    get messaging() {
        return this._messaging;
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

    get remote() {
        return this._remote;
    }

    get permissions() {
        return this._permissionManager;
    }

    _initGettext() {
        const gettext = this.platform.getCapability('gettext');
        this.gettext = function(string) {
            return gettext.dgettext('thingengine-core', string);
        };
        this.ngettext = function(msg, msgplural, count) {
            return gettext.dngettext('thingengine-core', msg, msgplural, count);
        };
        this.pgettext = function(msgctx, msg) {
            return gettext.dpgettext('thingengine-core', msgctx, msg);
        };
        this._ = this.gettext;
    }

    _openSequential(modules) {
        function open(i) {
            if (i === modules.length)
                return Promise.resolve();

            //console.log('Starting ' + modules[i].constructor.name);
            return modules[i].start().then(() => open(i+1));
        }

        return open(0);
    }

    _closeSequential(modules) {
        function close(i) {
            if (i < 0)
                return Promise.resolve();

            //console.log('Stopping ' + modules[i].constructor.name);
            return modules[i].stop().then(() => close(i-1));
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
        return this._closeSequential(this._modules).then(() => {
            console.log('Engine closed');
        });
    }

    // Kick start the engine by returning a promise that will
    // run each rule in sequence, forever, without ever being
    // fulfilled until engine.stop() is called
    run() {
        console.log('Engine running');

        this._running = true;

        return new Promise((callback, errback) => {
            if (!this._running) {
                callback();
                return;
            }
            this._stopCallback = callback;
        });
    }

    // Stop any rule execution at the next available moment
    // This will cause the run() promise to be fulfilled
    stop() {
        console.log('Engine stopped');
        this._running = false;
        if (this._stopCallback)
            this._stopCallback();
    }
};
module.exports.prototype.$rpcMethods = ['get devices', 'get apps', 'get messaging'];
