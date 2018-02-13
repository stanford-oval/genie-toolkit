// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const WebSocket = require('ws');
const Tp = require('thingpedia');

class GenericWebhookChannel extends Tp.BaseChannel {
    static get requiredCapabilities() {
        return ['webhook-api'];
    }

    _lateInit() {
        var id = this.name;
        var block;
        var ast = this.device.constructor.metadata;
        if (id in ast.triggers) {
            block = ast.triggers[id];
        } else {
            throw new Error('Invalid channel ' + id + ' in ' + this.device.kind);
        }

        var props = {};
        for (var name in block) {
            if (typeof block[name] === 'string')
                props[name] = String.prototype.format.apply(block[name],
                                                            this.device.params);
            else
                props[name] = block[name];
        }

        if (!('url' in props))
            throw new Error('Must specify endpoint url');
        this._url = props.url;
    }

    _makeAuth() {
        var ast = this.device.constructor.metadata;
        if (ast.auth.type === 'none') {
            return undefined;
        } else if (ast.auth.type === 'oauth2') {
            return undefined;
        } else if (ast.auth.type === 'basic') {
            return 'Basic ' + (new Buffer(this.device.username + ':' +
                                          this.device.password)).toString('base64');
        } else {
            return undefined;
        }
    }

    _emitParsed(parsed) {
        if (this._params) {
            var positional = this._params.map(function(p) {
                return parsed[p];
            });
            this.emitEvent(positional);
        } else {
            this.emitEvent(parsed);
        }
    }

    _onWebhook(method, query, headers, payload) {
        if (method !== 'POST')
            return;
        this._emitParsed(payload);
    }

    _doOpen() {
        this._lateInit();
        this._webhookListener = this._onWebhook.bind(this);
        var webhookApi = this.engine.platform.getCapability('webhook-api');
        webhookApi.registerWebhook(this.uniqueId, this._webhookListener);

        var auth = this._makeAuth();
        var url = this._url + encodeURIComponent(webhookApi.getWebhookBase() + '/' + this.uniqueId);
        return Tp.Helpers.Http.request(url, 'POST', null, { auth: auth, useOAuth2: this.device }).then(function() {
            console.log('Registered webhook at ' + url);
        });
    }

    _doClose() {
        var webhookApi = this.engine.platform.getCapability('webhook-api');
        webhookApi.unregisterWebhook(this.uniqueId);

        var auth = this._makeAuth();
        var url = this._url + encodeURIComponent(webhookApi.getWebhookBase() + '/' + this.uniqueId);
        return Tp.Helpers.Http.request(url, 'DELETE', null, { auth: auth, useOAuth2: this.device }).then(function() {
            console.log('Cleaned up webhook at ' + url);
        });
    }
}

class GenericTrigger extends Tp.BaseChannel {
    _lateInit() {
        var id = this.name;
        var ast = this.device.constructor.metadata;
        var block;
        if (id in ast.triggers) {
            block = ast.triggers[id];
        } else {
            throw new Error('Invalid channel ' + id + ' in ' + this.device.kind);
        }

        var props = {};
        for (var name in block) {
            if (typeof block[name] === 'string')
                props[name] = String.prototype.format.apply(block[name],
                                                            this.device.params);
            else
                props[name] = block[name];
        }

        if (!('url' in props))
            throw new Error('Must specify endpoint url');
        this._url = props.url;
        if (this._url.startsWith('ws')) {
            this._isWebsocket = true;
            this._url = 'http' + this._url.substr(2);
        } else {
            this._isWebsocket = false;
        }

        if ('params' in props) {
            if (!Array.isArray(props.params))
                throw new Error('params must be an array');
            this._params = props.params;
        } else {
            this._params = null;
        }

        if (!('method' in props)) {
            this._method = 'GET';
        } else {
            this._method = props.method;
        }

        if (!this._isWebsocket) {
            if ('poll-interval' in props)
                this._pollInterval = parseInt(props['poll-interval']);
            else
                this._pollInterval = 300000; // 5m
        } else {
            this._pollInterval = -1;
        }

        this._connection = null;
        this._timeout = null;
    }

    _makeAuth() {
        var ast = this.device.constructor.metadata;
        if (ast.auth.type === 'none') {
            return undefined;
        } else if (ast.auth.type === 'oauth2') {
            return undefined;
        } else if (ast.auth.type === 'basic') {
            return 'Basic ' + (new Buffer(this.device.username + ':' +
                                          this.device.password)).toString('base64');
        } else {
            return undefined;
        }
    }

    _emitBlob(blob) {
        var parsed = JSON.parse(blob);
        this._emitParsed(parsed);
    }

    _emitParsed(parsed) {
        if (this._params) {
            var positional = this._params.map(function(p) {
                return parsed[p];
            });
            this.emitEvent(positional);
        } else {
            this.emitEvent(parsed);
        }
    }

    _onTick() {
        var url = this._url;
        var method = this._method;
        var auth = this._makeAuth();

        return Tp.Helpers.Http.request(url, method, null, { auth: auth, useOAuth2: this.device,
                                                            accept: 'application/json' })
            .then(function(response) {
                try {
                    this._emitBlob(response);
                } catch(e) {
                    console.log('Error parsing server response: ' + e.message);
                    console.log('Full response was');
                    console.log(response);
                    return;
                }
            }.bind(this), function(error) {
                console.error('Error reading from server: ' + error.message);
            });
    }

    _doOpen() {
        this._lateInit();
        if (this._isWebsocket) {
            var auth = this._makeAuth();
            var headers = {};
            if (auth)
                headers['Authorization'] = auth;
            this._connection = new WebSocket(this._url, { headers: headers });
            this._connection.on('message', function(data) {
                try {
                    this._emitBlob(data);
                } catch(e) {
                    console.error('Failed to parse server websocket message: ' + e.message);
                }
            }.bind(this));
            this._connection.on('error', function(e) {
                console.error('Error on websocket connection: ' + e.message);
                this._connection.close();
                this._connection = null;
            });
            return Q();
        } else if (this._pollInterval !== -1) {
            this._timeout = setInterval(function() {
                    this._onTick().done();
            }.bind(this), this._pollInterval);
            return this._onTick();
        } else {
            return Q();
        }
    }

    _doClose() {
        if (this._isWebsocket) {
            if (this._connection)
                this._connection.close();
            this._connection = null;
        } else if (this._timeout) {
            clearInterval(this._timeout);
            this._timeout = null;
        }
        return Q();
    }
};

class GenericAction extends Tp.BaseChannel {
    _lateInit() {
        var id = this.name;
        var ast = this.device.constructor.metadata;
        var block;
        if (id in ast.actions) {
            block = ast.actions[id];
        } else {
            throw new Error('Invalid channel ' + id + ' in ' + this.device.kind);
        }

        var props = {};
        for (var name in block) {
            if (typeof block[name] === 'string')
                props[name] = String.prototype.format.apply(block[name],
                                                            this.device.params);
            else
                props[name] = block[name];
        }

        if (!('url' in props))
            throw new Error('Must specify endpoint url');
        this._url = props.url;
        if (this._url.startsWith('ws')) {
            this._isWebsocket = true;
            this._url = 'http' + this._url.substr(2);
        } else {
            this._isWebsocket = false;
        }

        if ('params' in props) {
            if (!Array.isArray(props.params))
                throw new Error('params must be an array');
            this._params = props.params;
        } else {
            this._params = null;
        }

        if ('default' in props)
            this._default = props['default'];
        else
            this._default = {};

        if (!('method' in props)) {
            this._method = 'POST';
        } else {
            this._method = props.method;
        }

        this._connection = null;
    }

    _makeAuth() {
        var ast = this.device.constructor.metadata;
        if (ast.auth.type === 'none') {
            return undefined;
        } else if (ast.auth.type === 'oauth2') {
            return undefined;
        } else if (ast.auth.type === 'basic') {
            return 'Basic ' + (new Buffer(this.device.username + ':' +
                                          this.device.password)).toString('base64');
        } else {
            return undefined;
        }
    }

    _doOpen() {
        this._lateInit();
        if (this._isWebsocket) {
            var auth = this._makeAuth();
            var headers = {};
            if (auth)
                headers['Authorization'] = auth;
            this._connection = new WebSocket(this._url, { headers: headers });
            this._connection.on('message', function(data) {
                try {
                    this._emitBlob(data);
                } catch(e) {
                    console.error('Failed to parse server websocket message: ' + e.message);
                }
            }.bind(this));
            this._connection.on('error', function(e) {
                console.error('Error on websocket connection: ' + e.message);
                this._connection.close();
                this._connection = null;
            });
            return Q();
        } else {
            return Q();
        }
    }

    _doClose() {
        if (this._isWebsocket) {
            if (this._connection)
                this._connection.close();
            this._connection = null;
        }
        return Q();
    }

    sendEvent(event) {
        let blob;
        if (this._params) {
            var obj = {};
            for (var name in this._default)
                obj[name] = this._default[name];
            this._params.forEach(function(p, i) {
                obj[p] = event[i];
            });
            blob = JSON.stringify(obj);
        } else {
            blob = JSON.stringify(event);
        }

        if (this._isWebsocket) {
            if (!this._connection)
                this._doOpen();
            this._connection.send(blob);
        } else {
            var url = this._url;
            var method = this._method;
            var auth = this._makeAuth();
            return Tp.Helpers.Http.request(url, method, blob,
                                    { auth: auth,
                                      useOAuth2: this.device,
                                      dataContentType: 'application/json' });
        }
    }
}

module.exports = class GenericRestModule {
    constructor(kind, ast) {
        this._id = kind;
        this._manifest = ast;
        var isNoneFactory = ast.auth.type === 'none' && Object.keys(ast.params).length === 0;
        var isNoneAuth = ast.auth.type === 'none';

        class GenericRestDevice extends Tp.BaseDevice {
            constructor(engine, state) {
                super(engine, state);

                var isNoneFactory = ast.auth.type === 'none' && Object.keys(ast.params).length === 0;
                var isNoneAuth = ast.auth.type === 'none';
                var params = Object.keys(ast.params);

                if (isNoneFactory)
                    this.uniqueId = kind;
                else if (isNoneAuth)
                    this.uniqueId = kind + '-' + params.map(function(k) { return k + '-' + state[k]; }).join('-');
                else
                    this.uniqueId = undefined; // let DeviceDatabase pick something

                if (ast.auth.type === 'oauth2' && Array.isArray(ast.auth.profile))
                    params = params.concat(ast.auth.profile);

                this.params = params.map(function(k) { return state[k]; });
                if (ast.name !== undefined)
                    this.name = String.prototype.format.apply(ast.name, this.params);
                if (ast.description !== undefined)
                    this.description = String.prototype.format.apply(ast.description,
                                                                     this.params);

                console.log('Generic device ' + this.name + ' initialized');
            }

            checkAvailable() {
                return Tp.Availability.AVAILABLE;
            }

            refreshCredentials() {
                // FINISHME refresh the access token using the refresh token
            }

            getTriggerClass(kind) {
                if (!(kind in ast.triggers))
                    throw new Error('Invalid channel name ' + kind);

                if (ast.triggers[kind].webhook)
                    return GenericWebhookChannel;
                else
                    return GenericTrigger;
            }

            getActionClass(kind) {
                if (!(kind in ast.actions))
                    throw new Error('Invalid channel name ' + kind);
                return GenericAction;
            }
        }
        this._loaded = GenericRestDevice;
        this._loaded.metadata = ast;

        function OAuthCallback(engine, accessToken, refreshToken) {
            var obj = { kind: kind,
                        accessToken: accessToken,
                        refreshToken: refreshToken };

            if (ast.auth.get_profile) {
                var auth = 'Bearer ' + accessToken;
                return Tp.Helpers.Http.get(ast.auth.get_profile, { auth: auth,
                                                                   accept: 'application/json' })
                    .then(function(response) {
                        var profile = JSON.parse(response);

                        ast.auth.profile.forEach(function(p) {
                            obj[p] = profile[p];
                        });

                        return engine.devices.loadOneDevice(obj, true);
                    });
            } else {
                return engine.devices.loadOneDevice(obj, true);
            }
        }

        var runOAuth2 = null;
        if (ast.auth.type === 'oauth2') {
            runOAuth2 = Tp.Helpers.OAuth2({ kind: kind,
                                            client_id: ast.auth.client_id,
                                            client_secret: ast.auth.client_secret,
                                            authorize: ast.auth.authorize,
                                            get_access_token: ast.auth.get_access_token,
                                            set_state: ast.auth.set_state,
                                            callback: OAuthCallback });
            runOAuth2.install(GenericRestDevice.prototype);
        }
        this._loaded.runOAuth2 = runOAuth2;
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
}
