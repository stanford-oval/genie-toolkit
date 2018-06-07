// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See LICENSE for details
"use strict";

const Tp = require('thingpedia');
const Utils = require('./utils');

function makeGenericOAuth(kind, ast, devclass) {
    function OAuthCallback(engine, accessToken, refreshToken) {
        var obj = { kind: kind,
                    accessToken: accessToken,
                    refreshToken: refreshToken };

        if (ast.auth.get_profile) {
            var auth = 'Bearer ' + accessToken;
            return Tp.Helpers.Http.get(ast.auth.get_profile, { auth: auth,
                                                            accept: 'application/json' })
                .then((response) => {
                    var profile = JSON.parse(response);

                    ast.auth.profile.forEach((p) => {
                        obj[p] = profile[p];
                    });

                    return engine.devices.loadOneDevice(obj, true);
                });
        } else {
            return engine.devices.loadOneDevice(obj, true);
        }
    }

    var runOAuth2 = Tp.Helpers.OAuth2({ kind: kind,
                                     client_id: ast.auth.client_id,
                                     client_secret: ast.auth.client_secret,
                                     authorize: ast.auth.authorize,
                                     get_access_token: ast.auth.get_access_token,
                                     set_state: ast.auth.set_state,
                                     callback: OAuthCallback });
    runOAuth2.install(devclass.prototype);
    devclass.runOAuth2 = runOAuth2;
}

module.exports = class BaseGenericModule {
    constructor(kind, ast) {
        this._id = kind;
        this._manifest = ast;

        const isNoneFactory = ast.auth.type === 'none' && Object.keys(ast.params).length === 0;
        const isNoneAuth = ast.auth.type === 'none';
        this._loaded = class GenericDevice extends Tp.BaseDevice {
            constructor(engine, state) {
                super(engine, state);

                let params = Object.keys(ast.params);
                if (isNoneFactory)
                    this.uniqueId = kind;
                else if (isNoneAuth)
                    this.uniqueId = kind + '-' + params.map((k) => (k + '-' + state[k])).join('-');
                else
                    this.uniqueId = undefined; // let DeviceDatabase pick something

                if (ast.auth.type === 'oauth2' && Array.isArray(ast.auth.profile))
                    params = params.concat(ast.auth.profile);

                this.params = params.map((k) => state[k]);
                if (ast.name !== undefined)
                    this.name = Utils.formatString(ast.name, this.state);
                if (ast.description !== undefined)
                    this.description = Utils.formatString(ast.description, this.state);
            }

            checkAvailable() {
                return Tp.BaseDevice.Availability.AVAILABLE;
            }
        };
        if (ast.auth.type === 'oauth2')
            makeGenericOAuth(kind, ast, this._loaded);

        this._loaded.metadata = ast;
    }

    get id() {
        return this._id;
    }
    get manifest() {
        return this._manifest;
    }
    get version() {
        return this._manifest.version;
    }

    clearCache() {
        // nothing to do here
    }

    getDeviceFactory() {
        return this._loaded;
    }
};
