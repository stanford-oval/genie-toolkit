// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const BaseDevice = require('../../base_device');

const GoogleAccountDevice = new lang.Class({
    Name: 'GoogleAccountDevice',
    Extends: BaseDevice,

    _init: function(engine, state) {
        this.parent(engine, state);

        this.uniqueId = 'google-account-' + this.profileId;
        this.name = "Google Account %s".format(this.profileId);
        this.description = "This is your Google Account. You can use it to access Google Fit data, emails, calendars and more.";
    },

    get profileId() {
        return this.state.profileId;
    },

    get accessToken() {
        return this.state.accessToken;
    },

    checkAvailable: function() {
        return BaseDevice.Availability.AVAILABLE;
    },

    hasKind: function(kind) {
        switch (kind) {
        case 'google-account':
            return true;
        default:
            return this.parent(kind);
        }
    },

    _getGoogleApi: function() {
        if (this._googleApi)
            return this._googleApi;

        // on-demand load so we don't try to load
        // the android APIs where we don't have them
        if (platform.hasCapability('android-api'))
            this._googleApi = require('./androidapi')(this);
        else
            this._googleApi = require('./webapi')(this);
        return this._googleApi;
    },

    queryInterface: function(iface) {
        switch (iface) {
        case 'oauth':
            return this;
        case 'google-docs':
            return this._getGoogleApi().googleDocs;
        case 'google-fit':
            return this._getGoogleApi().googleFit;

        default:
            return null;
        }
    },

    refreshCredentials: function() {
        // if we're using the android API we have nothing to do
        if (platform.hasCapability('android-api'))
            return;

        // FINISHME refresh the access token using the refresh token
    },
});

function createDevice(engine, state) {
    return new GoogleAccountDevice(engine, state);
}

function getConfigUI() {
    return { type: 'link', href: '/devices/oauth2/google-account',
              text: "Click here to associate a Google Account with your ThingEngine" };
}

module.exports.createDevice = createDevice;
module.exports.getConfigUI = getConfigUI;
