// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Config = require('./config');

const Q = require('q');
const lang = require('lang');

const tc = require('./tier_connections');

const Tier = {
    PHONE: 0,
    SERVER: 1,
    CLOUD: 2
};
const TIER_LAST = 3;

function tierToString(tier) {
    switch (tier) {
    case Tier.PHONE:
        return 'phone';
    case Tier.SERVER:
        return 'server';
    case Tier.CLOUD:
        return 'cloud';
    }
}

// Note: this should be the only module (togheter with
// tier_connections) in the engine to have intimate knowledge of what
// a platform is, and host platform specific code; other code
// (especially apps, except for a few system apps like 'server-config' and 'cloud-config')
// should be platform agnostic and rely on platform capabilities
// instead

module.exports = new lang.Class({
    Name: 'TierManager',

    _init: function() {
        this.ownTier = -1;

        if (platform.type == 'android' || platform.type == 'ios')
            this.ownTier = Tier.PHONE;
        else if (platform.type == 'server')
            this.ownTier = Tier.SERVER;
        else if (platform.type == 'cloud')
            this.ownTier = Tier.CLOUD;
        else
            throw new Error('Unable to determine currently running tier');

        console.log('Tier manager initialized for ' + tierToString(this.ownTier));

        this._tierOpens = [null,null,null];
        this._tierSockets = [null,null,null];
        // initial timer is approx 4 minutes (2**18 ms), grows
        // exponentially times 1.5 up to approx 1 day
        this._tierBackoffs = [262144,262144,262144];

        this._tierOutgoingBuffers = [[],[],[]];

        this._handlers = {};
    },

    _backoffTimer: function(tier) {
        var backoff = this._tierBackoffs[tier];
        // no need to do integer math, 1.5 can be express with perfect
        // precision as double
        this._tierBackoffs[tier] *= 1.5;
        if (this._tierBackoffs[tier] >= 76527504) // approx 21h
            this._tierBackoffs[tier] = 76527504;
        return backoff;
    },

    _tryOpenOne: function(tier) {
        var f = this._tierOpens[tier];
        if (f === null)
            return null;
        var socket = f();
        if (socket === null)
            return null;

        this._tierSockets[tier] = socket;
        socket.on('failed', function(lostMessages) {
            console.log('Tier connection to ' + tierToString(tier)
                        + ' failed');
            // adopt the outgoing messages that the socket did not write
            this._tierOutgoingBuffers[tier] = lostMessages.concat(this._tierOutgoingBuffers[tier]);
            this._tierSockets[tier] = null;

            // Try again at some point in the future
            var timer = this._backoffTimer(tier);
            console.log('Trying again in ' + Math.floor(timer/60000) + ' minutes');
            setTimeout(function() {
                this._tryOpenOne(tier).done();
            }.bind(this), timer);
        }.bind(this));

        socket.on('message', function(msg) {
            if (this._tierSockets[tier] !== socket) // robustness
                return;

            this._routeMessage(tier, msg);
        }.bind(this));

        return socket.open().then(function(success) {
            if (success) {
                var buffer = this._tierOutgoingBuffers[tier];
                this._tierOutgoingBuffers[tier] = [];
                socket.sendMany(buffer);
            }
        }.bind(this));
    },

    _openAll: function() {
        var promises = [];
        for (var i = 0; i < TIER_LAST; i++) {
            var p = this._tryOpenOne(i);
            if (p !== null)
                promises.push(p);
        }

        return Q.all(promises);
    },

    _openNone: function() {
        this._tierSockets[Tier.PHONE] = null;
        this._tierSockets[Tier.SERVER] = null;
        this._tierSockets[Tier.CLOUD] = null;
        return Q();
    },

    _openPhone: function() {
        var prefs = platform.getSharedPreferences();

        var authToken = prefs.get('auth-token');
        if (authToken === undefined) {
            console.log('Not yet paired with any other tier, bailing...');
            return this._openNone();
        }

        var toPhone = null;
        var toServer = function() {
            var authToken = prefs.get('auth-token');
            var serverAddress = prefs.get('server-address');
            if (serverAddress !== undefined)
                return new tc.ClientConnection(serverAddress, tierToString(Tier.PHONE), authToken);
            else
                return null;
        };
        var toCloud = function() {
            var authToken = prefs.get('auth-token');
            var cloudId = prefs.get('cloud-id');
            if (cloudId !== undefined)
                return new tc.ClientConnection(Config.THINGPEDIA_URL + '/ws/' + cloudId,
                                               tierToString(Tier.PHONE), authToken);
            else
                return null;
        };

        this._tierOpens[Tier.PHONE] = toPhone;
        this._tierOpens[Tier.SERVER] = toServer;
        this._tierOpens[Tier.CLOUD] = toCloud;
        return this._openAll();
    },

    _openServer: function() {
        var prefs = platform.getSharedPreferences();

        var authToken = prefs.get('auth-token');
        if (authToken === undefined) {
            // If there is no auth token configured, we're in initial setup mode
            // In this mode, we'll allow any connection from a phone
            // but we don't connect to the cloud
            console.log('Server starting in initial setup mode...');
        }

        var toPhone = function() {
            var authToken = prefs.get('auth-token');
            return new tc.ServerConnection(authToken,
                                           [tierToString(Tier.PHONE)]);
        }
        var toServer = null;
        var toCloud = function() {
            var authToken = prefs.get('auth-token');
            var cloudId = prefs.get('cloud-id');
            if (cloudId !== undefined && authToken !== undefined)
                return new tc.ClientConnection(Config.THINGPEDIA_URL + '/ws/' + cloudId,
                                               tierToString(Tier.SERVER), authToken);
            else
                return null;
        }

        this._tierOpens[Tier.PHONE] = toPhone;
        this._tierOpens[Tier.SERVER] = toServer;
        this._tierOpens[Tier.CLOUD] = toCloud;
        return this._openAll();
    },

    _openCloud: function() {
        var prefs = platform.getSharedPreferences();

        var authToken = prefs.get('auth-token');
        if (authToken === undefined) {
            // Crash
            throw new Error('Cloud platform without a valid auth token!');
        }

        var cloudId = prefs.get('cloud-id');
        if (cloudId === undefined) {
            // Crash
            throw new Error('Cloud platform without a valid cloud id!');
        }

        var toPhone = function() {
            var authToken = prefs.get('auth-token');
            var cloudId = prefs.get('cloud-id');
            return new tc.ServerConnection(authToken, [tierToString(Tier.PHONE), tierToString(Tier.SERVER)]);
        }
        var toServer = null;
        var toCloud = null;
        this._tierOpens[Tier.PHONE] = toPhone;
        this._tierOpens[Tier.SERVER] = toServer;
        this._tierOpens[Tier.CLOUD] = toCloud;
        return this._openAll();
    },

    open: function() {
        switch(this.ownTier) {
        case Tier.PHONE:
            return this._openPhone();
        case Tier.SERVER:
            return this._openServer();
        case Tier.CLOUD:
            return this._openCloud();
        }
    },

    _closeOne: function(tier) {
        if (this._tierSockets[tier] != null)
            return this._tierSockets[tier].close();
        else
            return Q();
    },

    close: function() {
        return Q.all(this._tierSockets.filter(function(s) {
            return s !== null;
        }).map(function(s) {
            return s.close();
        }));
    },

    // Semi private API used by the config-* apps
    _reopenOne: function(tier) {
        return this._closeOne(tier).then(function() {
            return this._tryOpenOne(tier);
        }.bind(this));
    },

    registerHandler: function(target, handler) {
        if (target in this._handlers)
            throw new Error('Handler for target ' + target + ' already registered');

        this._handlers[target] = handler;
    },

    _routeMessage: function(tier, msg) {
        if (msg.control)
            throw new Error('Unexpected control message in TierManager');

        var target = msg.target;
        if (target in this._handlers) {
            this._handlers[target](tier, msg);
        } else {
            console.error('Message target ' + target + ' not recognized');
        }
    },

    sendTo: function(tier, msg) {
        if (this._tierSockets[tier] != null)
            this._tierSockets[tier].send(msg);
        else
            this._tierOutgoingBuffers[tier].push(msg);
    },

    sendToAll: function() {
        this._tierSockets.forEach(function(s) {
            s.send(msg);
        });
    },
});

module.exports.Tier = Tier;
