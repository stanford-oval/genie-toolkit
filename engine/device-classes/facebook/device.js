// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');
const Tp = require('thingpedia');

module.exports = new Tp.DeviceClass({
    Name: 'FacebookDevice',
    Extends: Tp.OnlineAccount,

    _init: function(engine, state) {
        this.parent(engine, state);

        this.uniqueId = 'facebook-' + this.profileId;
        this.name = "Facebook Account %s".format(this.profileId);
        this.description = "This is your Facebook Account. You can use it to access your wall, follow your friends, send messages and more.";
    },

    get profileId() {
        return this.state.profileId;
    },

    get accessToken() {
        return this.state.accessToken;
    },

    queryInterface: function(iface) {
        switch (iface) {
        case 'oauth2':
            return this;
        default:
            return null;
        }
    },

    refreshCredentials: function() {
        // FINISHME refresh the access token using the refresh token
    },
});
