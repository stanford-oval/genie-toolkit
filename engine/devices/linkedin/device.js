// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');
const Url = require('url');
const crypto = require('crypto');
const oauth = require('oauth');

const BaseDevice = require('../../base_device');

// encryption ;)
function rot13(x) {
    return Array.prototype.map.call(x, function(ch) {
        var code = ch.charCodeAt(0);
        if (code >= 0x41 && code <= 0x5a)
            code = (((code - 0x41) + 13) % 26) + 0x41;
        else if (code >= 0x61 && code <= 0x7a)
            code = (((code - 0x61) + 13) % 26) + 0x61;

        return String.fromCharCode(code);
    }).join('');
}

const CONSUMER_KEY = process.env['LINKEDIN_CONSUMER_KEY'] || '75j2y6wjan5rt2';
const CONSUMER_SECRET = process.env['LINKEDIN_CONSUMER_SECRET'] || rot13('RuNnl6Yro69G78lX');

// XOR these comments for testing
var THINGENGINE_ORIGIN = 'http://127.0.0.1:8080';
//var THINGENGINE_ORIGIN = 'https://thingengine.stanford.edu';
// not this one though
var THINGENGINE_LOCAL_ORIGIN = 'http://127.0.0.1:3000';

function makeLinkedInAPI() {
    var auth = new oauth.OAuth2(CONSUMER_KEY, CONSUMER_SECRET,
                                '',
                                'https://www.linkedin.com/uas/oauth2/authorization',
                                'https://www.linkedin.com/uas/oauth2/accessToken');
    auth.useAuthorizationHeaderforGET(true);
    return auth;
}

const LinkedInAccountDevice = new lang.Class({
    Name: 'LinkedInAccountDevice',
    Extends: BaseDevice,

    _init: function(engine, state) {
        this.parent(engine, state);

        this.uniqueId = 'linkedin-' + this.userId;
        this.name = "Linkedin Account %s".format(this.formattedName);
        this.description = "This is your Linkedin Account. You can share it with your friends and they will receive your updates.";
    },

    get formattedName() {
        return this.state.formattedName;
    },

    get userId() {
        return this.state.userId;
    },

    get accessToken() {
        return this.state.accessToken;
    },

    get ownerTier() {
        return 'global';
    },

    checkAvailable: function() {
        return BaseDevice.Availability.AVAILABLE;
    },

    hasKind: function(kind) {
        switch (kind) {
        case 'online-account':
            return true;
        default:
            return this.parent(kind);
        }
    }
});

function createDevice(engine, state) {
    return new LinkedInAccountDevice(engine, state);
}

function runOAuthStep1(engine) {
    var auth = makeLinkedInAPI();

    var origin;
    if (engine.ownTier === 'cloud')
        origin = THINGENGINE_CLOUD_ORIGIN;
    else
        origin = THINGENGINE_LOCAL_ORIGIN;
    var state = crypto.randomBytes(16).toString('hex');
    return [auth.getAuthorizeUrl({ response_type: 'code',
                                   redirect_uri: origin + '/devices/oauth2/callback/linkedin',
                                   state: state,
                                 }), { 'linkedin-state': state }];
}

function runOAuthStep2(engine, req) {
    var auth = makeLinkedInAPI();

    var code = req.query.code;
    var state = req.query.state;
    if (state !== req.session['linkedin-state'])
        return Q.reject(new Error("Invalid CSRF token"));
    delete req.session['linkedin-state'];

    var origin;
    if (engine.ownTier === 'cloud')
        origin = THINGENGINE_CLOUD_ORIGIN;
    else
        origin = THINGENGINE_LOCAL_ORIGIN;
    return Q.ninvoke(auth, 'getOAuthAccessToken', code, { grant_type: 'authorization_code',
                                                          redirect_uri: origin + '/devices/oauth2/callback/linkedin',
                                                        })
        .then(function(result) {
            var accessToken = result[0];
            var refreshToken = result[1];
            var response = result[2];

            return Q.ninvoke(auth, 'get', 'https://api.linkedin.com/v1/people/~:(id,formatted-name)?format=json',
                             accessToken)
                .then(function(result) {
                    var profile = result[0];
                    var response = result[1];
                    console.log('profile', profile);
                    profile = JSON.parse(profile)

                    return engine.devices.loadOneDevice({ kind: 'linkedin',
                                                          accessToken: accessToken,
                                                          refreshToken: refreshToken,
                                                          userId: profile.id,
                                                          formattedName: profile.formattedName }, true);
                });
        });
}

function runOAuth2(engine, req) {
    return Q.try(function() {
        if (req === null) {
            return runOAuthStep1(engine);
        } else {
            return runOAuthStep2(engine, req);
        }
    }).catch(function(e) {
        console.log(e);
        console.log(e.stack);
        throw e;
    });
}

module.exports.createDevice = createDevice;
module.exports.runOAuth2 = runOAuth2;
