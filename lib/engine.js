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
const path = require('path');
const fs = require('fs');
const ThingTalk = require('thingtalk');

const DeviceDatabase = require('./devices/database');
const DeviceFactory = require('./devices/thingpedia/factory');
const ThingPediaHttpClient = require('./devices/thingpedia/http_client');
const ChannelFactory = require('./devices/channel_factory');
const TierManager = require('./tiers/tier_manager');
const PairedEngineManager = require('./tiers/paired');
const Logger = require('./logger');

module.exports = class Engine {
    constructor(platform) {
        // constructor

        this._platform = platform;
        this._initGettext();

        this._tiers = new TierManager(platform);

        // tiers and devices are always enabled
        var hasApps = platform.hasFeature('apps');
        var hasMessaging = platform.hasFeature('messaging');
        var hasGraphdb = platform.hasFeature('graphdb');
        if (hasGraphdb && !hasMessaging)
            throw new Error('Graphdb feature requires messaging (for federated queries)');
        var hasDiscovery = platform.hasFeature('discovery');
        if (hasApps && !hasGraphdb)
            throw new Error('Apps feature require graphdb (to store keywords)');

        this._modules = [];

        if (platform.hasCapability('thingpedia-client'))
            this._thingpedia = platform.getCapability('thingpedia-client');
        else
            this._thingpedia = new ThingPediaHttpClient(platform.getDeveloperKey());

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

        // in loading order
        this._modules = [this._tiers,
                         this._devices,
                         new PairedEngineManager(platform, this._devices, this._tiers),
                         this._channels,
                         new Logger(this._channels)];

        if (hasMessaging) {
            var MessagingDeviceManager = require('./messaging/device_manager');
            this._messaging = new MessagingDeviceManager(this._devices);
            this._modules.push(this._messaging);
        } else {
            this._messaging = null;
        }
        if (hasGraphdb) {
            var SparqlRunner = require('./graphdb/sparql_runner');
            var GraphMetaStore = require('./graphdb/metastore');
            this._graphdb = new GraphMetaStore(platform, this._messaging, this._devices);
            this._sparql = new SparqlRunner(this._graphdb);
            this._modules.push(this._graphdb);
            this._modules.push(this._sparql);
        } else {
            this._graphdb = null;
            this._sparql = null;
        }
        if (hasApps) {
            var AppDatabase = require('./apps/database');
            var KeywordRegistry = require('./keyword/registry');
            this._keywords = new KeywordRegistry(this._graphdb, this._messaging);
            this._appdb = new AppDatabase(this);
            this._modules.push(this._keywords);
            this._modules.push(this._appdb);
        } else {
            this._keywords = null;
            this._appdb = null;
        }
        if (hasApps) {
            var AppRunner = require('./apps/runner');
            this._apprunner = new AppRunner(this._appdb);
            this._modules.push(this._apprunner);
        }
        if (hasGraphdb) {
            var MessagingQueryResponder = require('./messaging/query_responder');
            this._modules.push(new MessagingQueryResponder(this._graphdb, this._messaging));
        }
        if (hasDiscovery) {
            var Discovery = require('thingpedia-discovery');
            this._discovery = new Discovery.Client(platform, this._devices, this._thingpedia);
            this._modules.push(this._discovery);
        } else {
            this._discovery = null;
        }

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

    get thingpedia() {
        return this._thingpedia;
    }

    get schemas() {
        return this._schemas;
    }

    get apps() {
        return this._appdb;
    }

    get graphdb() {
        return this._graphdb;
    }

    get sparql() {
        return this._sparql;
    }

    get discovery() {
        return this._discovery;
    }

    _initGettext() {
        if (this.platform.hasCapability('gettext') && this.platform.locale !== 'en_US' && this.platform.locale !== 'en_US.utf8') {
            var locale = this.platform.locale.split(/[-_\.@]/);
            var gettext = this.platform.getCapability('gettext');
            var modir = path.resolve(path.dirname(module.filename), '../po');
            var mo = modir + '/' + locale.join('_') + '.mo';
            console.log('mo', mo);
            while (!fs.existsSync(mo) && locale.length) {
                locale.pop();
                mo = modir + '/' + locale.join('_') + '.mo';
            }
            try {
                gettext.addTextdomain("thingengine-core", fs.readFileSync(mo));
            } catch(e) {
                console.error('Failed to load translation file: ' + e.message);
            }
            this.gettext = function(string) {
                return gettext.dgettext("thingengine-core", string);
            };
            this.ngettext = function(msg, msgplural, count) {
                return gettext.dngettext('thingengine-core', msg, msgplural, count);
            }
            this.pgettext = function(msgctx, msg) {
                return gettext.dpgettext('thingengine-core', msgctx, msg);
            }
            this._ = this.gettext;
            this.C_ = this.pgettext;
        } else {
            this.gettext = (msg) => msg;
            this.ngettext = (msg, msgp, count) => msg;
            this.pgettext = (ctx, msg) => msg;
            this._ = this.gettext;
            this.C_ = this.gettext;
        }
        this.N_ = (msg) => msg;
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
