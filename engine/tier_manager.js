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

const tier_connections = require('./tier_connections');

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
        this._ownTier = -1;

        if (platform.type == 'android' || platform.type == 'ios')
            this._ownTier = Tier.PHONE;
        else if (platform.type == 'server')
            this._ownTier = Tier.SERVER;
        else if (platform.type == 'cloud')
            this._ownTier = Tier.CLOUD;
        else
            throw new Error('Unable to determine currently running tier');

        console.log('Tier manager initialized for ' + tierToString(this._ownTier));

        this._tierSockets = new Array(TIER_LAST);
    },

    _openAll: function() {
        return Q.all(this._tierSockets.filter(function(s) {
            return s !== null;
        }).map(function(s) {
            return s.open();
        }));
    },

    _openNone: function() {
        this._tierSockets[Tier.PHONE] = null;
        this._tierSockets[Tier.SERVER] = null;
        this._tierSockets[Tier.CLOUD] = null;
        return Q(undefined);
    },

    _openPhone: function() {
        var prefs = platform.getSharedPreferences();

        var authToken = prefs.get('auth-token');
        if (authToken === undefined) {
            console.log('Not yet paired with any other tier, bailing...');
            return this._openNone();
        }

        var serverAddress = prefs.get('server-address');
        var toPhone = null;
        var toServer = null;
        if (serverAddress !== undefined)
            toServer = new ClientConnection(serverAddress, authToken);
        var cloudId = prefs.get('cloud-id');
        var toCloud = null;
        if (cloudId !== undefined)
            toCloud = new ClientConnection(Config.THINGPEDIA_URL + '/ws/' + cloudId, authToken);

        this._tierSockets[Tier.PHONE] = toPhone;
        this._tierSockets[Tier.SERVER] = toServer;
        this._tierSockets[Tier.CLOUD] = toCloud;
        return this._openAll();
    },

    _openServer: function() {
        var prefs = platform.getSharedPreferences();

        var authToken = prefs.get('auth-token');
        if (authToken === undefined) {
            console.log('Not yet paired with any other tier, bailing...');
            return this._openNone();
        }

        var toPhone = new ServerConnection('/websocket', authToken) ;
        var toServer = null;
        var cloudId = prefs.get('cloud-id');
        var toCloud = null;
        if (cloudId !== undefined)
            toCloud = new ClientConnection(Config.THINGPEDIA_URL + '/ws/' + cloudId, authToken);

        this._tierSockets[Tier.PHONE] = toPhone;
        this._tierSockets[Tier.SERVER] = toServer;
        this._tierSockets[Tier.CLOUD] = toCloud;
        return this._openAll();
    },

    _openCloud: function() {
        var prefs = platform.getSharedPreferences();

        var authToken = prefs.get('auth-token');
        if (authToken === undefined) {
            console.log('Not yet paired with any other tier, bailing...');
            return this._openNone();
        }

        var cloudId = prefs.get('cloud-id');
        if (cloudId === undefined) {
            // Crash
            throw new Error('Cloud platform without a valid cloud id!');
        }

        var toPhone = new ServerConnection(Config.THINGPEDIA_URL + '/ws/' + cloudId, authToken);
        var toServer = null;
        var toCloud = null;
        this._tierSockets[Tier.PHONE] = toPhone;
        this._tierSockets[Tier.SERVER] = toServer;
        this._tierSockets[Tier.CLOUD] = toCloud;
        return this._openAll();
    },

    open: function() {
        switch(this._ownTier) {
        case Tier.PHONE:
            return this._openPhone();
        case Tier.SERVER:
            return this._openServer();
        case Tier.CLOUD:
            return this._openCloud();
        }
    },

    close: function() {
        return Q.all(this._tierSockets.filter(function(s) {
            return s !== null;
        }).map(function(s) {
            return s.close();
        }));
    }
});
