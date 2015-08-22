// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const crypto = require('crypto');
const lang = require('lang');
const Q = require('q');

const BaseApp = require('../base_app');
const Tier = require('../tier_manager').Tier;
const tc = require('../tier_connections');

function getAuthToken() {
    var prefs = platform.getSharedPreferences();
    var authToken = prefs.get('auth-token');
    if (authToken === undefined) {
        // No auth token, generate one now with 256 random bits
        authToken = crypto.randomBytes(32).toString('hex');
        prefs.set('auth-token', authToken);
    }
    return authToken;
}

// 'config-server' is an app whose sole purpose is to deploy ThingEngine
// on a private server, when such a server appears
const ConfigServerApp = new lang.Class({
    Name: 'ConfigServerApp',
    Extends: BaseApp,

    // no cached state, this app manipulates the engine settings
    _init: function(engine, state) {
        this.parent(engine, state);

        this._listener = null;
    },

    get allowedTiers() {
        return [Tier.PHONE];
    },

    _onDeviceAdded: function(device) {
        if (!device.hasKind('thingengine-server'))
            return;

        // FINISHME: some interaction with the user or confirmation
        // would be nice here...

        console.log('Found ThingEngine Server at ' + device.host
                    + ' port ' + device.port);
        console.log('Autoconfiguring...');

        var engine = this.engine;
        var serverAddress = 'http://' + device.host + ':' + device.port + '/websocket';

        // Open a temporary connection with the server to set up the auth token
        // we pass undefined to ClientConnection to prevent it from doing its
        // own auth
        var connection = new tc.ClientConnection(serverAddress, undefined);
        connection.open().then(function() {
            console.log('Configuring server with auth token'); 
            connection.send({control:'set-auth-token', token: getAuthToken()});

            connection.on('message', function(msg) {
                connection.close();

                if (msg.control !== 'auth-token-ok') {
                    console.log('Server rejected pairing request');
                    return;
                }

                var prefs = platform.getSharedPreferences();
                prefs.set('server-address', serverAddress);

                // NOTE: private API usage!
                engine._tiers._reopen(Tier.SERVER);
            });
        });

    },

    start: function() {
        var prefs = platform.getSharedPreferences();
        if (prefs.get('server-address') !== undefined)
            return Q();

        // Start watching for changes to the device database
        this._listener = this._onDeviceAdded.bind(this);
        this.engine.devices.on('device-added', this._listener);
        return Q();
    },

    stop: function() {
        if (this._listener != null)
            this.engine.devices.removeListener('device-added', this._listener);
        this._listener = null;
        return Q();
    }
});

function createApp(engine, state) {
    return new ConfigServerApp(engine, state);
}

module.exports.createApp = createApp;
