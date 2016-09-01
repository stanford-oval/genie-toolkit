// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const WebSocket = require('ws');
const Tp = require('thingpedia');

module.exports = function(kind, code) {
    var ast = JSON.parse(code);
    var isNoneFactory = ast.auth.type === 'none' && Object.keys(ast.params).length === 0;
    var isNoneAuth = ast.auth.type === 'none';

    const GenericDevice = new Tp.DeviceClass({
        Name: 'GenericDevice',

        _init: function(engine, state) {
            this.parent(engine, state);

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
        },

        checkAvailable: function() {
            return Tp.Availability.AVAILABLE;
        },

        refreshCredentials: function() {
            // FINISHME refresh the access token using the refresh token
        },

        getTriggerClass: function(kind) {
            if (!(kind in ast.triggers))
                throw new Error('Invalid channel name ' + kind);
            return {
                requiredCapabilities: (ast.triggers[kind].rss ? ['channel-state'] : (ast.triggers[kind].webhook ? ['webhook-api'] : [])),

                createChannel: function(engine, state, device, params) {
                    if (ast.triggers[kind].rss)
                        return new GenericRSSChannel(kind, engine, state, device, params);
                    else if (ast.triggers[kind].webhook)
                        return new GenericWebhookChannel(kind, engine, state, device, params);
                    else
                        return new GenericTrigger(kind, engine, state, device, params);
                }
            }
        },

        getActionClass: function(kind) {
            if (!(kind in ast.actions))
                throw new Error('Invalid channel name ' + kind);
            return {
                createChannel: function(kind, engine, device, params) {
                    return new GenericAction(kind, engine, device, params);
                }
            }
        }
    });
    GenericDevice.metadata = ast;

    const GenericRSSChannel = new Tp.ChannelClass({
        Name: 'GenericRSSChannel',
        Extends: Tp.RSSPollingTrigger,
        RequiredCapabilities: ['channel-state'],

        _init: function(id, engine, state, device, params) {
            this.parent(engine, state, device);

            console.log('Initializing generic RSS channel ' + id);

            var block;
            if (id in ast.triggers) {
                block = ast.triggers[id];
            } else {
                throw new Error('Invalid channel ' + id + ' in ' + kind);
            }

            var props = {};
            for (var name in block) {
                if (typeof block[name] === 'string')
                    props[name] = String.prototype.format.apply(block[name],
                                                                device.params);
                else
                    props[name] = block[name];
            }

            if (!('url' in props))
                throw new Error('Must specify endpoint url');
            this.url = props.url;

            if ('poll-interval' in props)
                this.interval = parseInt(props['poll-interval']);
            else
                this.interval = 3 * 3600 * 1000; // 3h

            this.auth = this._makeAuth();
            this.useOAuth2 = this.device;
        },

        _makeAuth: function() {
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
        },

        formatEvent: function(event, filters) {
            var title = event[0];
            var link = event[1];
            return [{
                type: 'rdl',
                what: 'post',
                displayTitle: title,
                callback: link,
                webCallback: link
            }];
        },

        _emit: function(entry) {
            this.emitEvent([entry[0], entry[1]]);
        }
    });

    const GenericWebhookChannel = new Tp.ChannelClass({
        Name: 'GenericWebhookChannel',
        RequiredCapabilities: ['webhook-api'],

        _init: function(id, engine, device, params) {
            this.parent(engine, device);

            var block;
            if (id in ast.triggers) {
                block = ast.triggers[id];
            } else {
                throw new Error('Invalid channel ' + id + ' in ' + kind);
            }

            var props = {};
            for (var name in block) {
                if (typeof block[name] === 'string')
                    props[name] = String.prototype.format.apply(block[name],
                                                                device.params);
                else
                    props[name] = block[name];
            }

            if (!('url' in props))
                throw new Error('Must specify endpoint url');
            this._url = props.url;
        },

        _makeAuth: function() {
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
        },

        _emitParsed: function(parsed) {
            if (this._params) {
                var positional = this._params.map(function(p) {
                    return parsed[p];
                });
                this.emitEvent(positional);
            } else {
                this.emitEvent(parsed);
            }
        },

        _onWebhook: function(method, query, headers, payload) {
            if (method !== 'POST')
                return;
            this._emitParsed(payload);
        },

        _doOpen: function() {
            this._webhookListener = this._onWebhook.bind(this);
            var webhookApi = this.engine.platform.getCapability('webhook-api');
            webhookApi.registerWebhook(this.uniqueId, this._webhookListener);

            var auth = this._makeAuth();
            var url = this._url + encodeURIComponent(webhookApi.getWebhookBase() + '/' + this.uniqueId);
            return Tp.Helpers.Http.request(url, 'POST', null, { auth: auth, useOAuth2: this.device }).then(function() {
                console.log('Registered webhook at ' + url);
            });
        },

        _doClose: function() {
            var webhookApi = this.engine.platform.getCapability('webhook-api');
            webhookApi.unregisterWebhook(this.uniqueId);

            var auth = this._makeAuth();
            var url = this._url + encodeURIComponent(webhookApi.getWebhookBase() + '/' + this.uniqueId);
            return Tp.Helpers.Http.request(url, 'DELETE', null, { auth: auth, useOAuth2: this.device }).then(function() {
                console.log('Cleaned up webhook at ' + url);
            });
        },
    });

    const GenericTrigger = new Tp.ChannelClass({
        Name: 'GenericTrigger',

        _init: function(id, engine, device, params) {
            this.parent(engine, device);

            var block;
            if (id in ast.triggers) {
                block = ast.triggers[id];
            } else {
                throw new Error('Invalid channel ' + id + ' in ' + kind);
            }

            var props = {};
            for (var name in block) {
                if (typeof block[name] === 'string')
                    props[name] = String.prototype.format.apply(block[name],
                                                                device.params);
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
        },

        _makeAuth: function() {
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
        },

        _emitBlob: function(blob) {
            var parsed = JSON.parse(blob);
            this._emitParsed(parsed);
        },

        _emitParsed: function(parsed) {
            if (this._params) {
                var positional = this._params.map(function(p) {
                    return parsed[p];
                });
                this.emitEvent(positional);
            } else {
                this.emitEvent(parsed);
            }
        },

        _onTick: function() {
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
        },

        _doOpen: function() {
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
        },

        _doClose: function() {
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
    })

    const GenericAction = new Tp.ChannelClass({
        Name: 'GenericAction',

        _init: function(id, engine, device, params) {
            this.parent(engine, device);

            var block;
            if (id in ast.actions) {
                block = ast.actions[id];
                source = false;
            } else {
                throw new Error('Invalid channel ' + id + ' in ' + kind);
            }

            var props = {};
            for (var name in block) {
                if (typeof block[name] === 'string')
                    props[name] = String.prototype.format.apply(block[name],
                                                                device.params);
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
                if (source)
                    this._method = 'GET';
                else
                    this._method = 'POST';
            } else {
                this._method = props.method;
            }

            this._connection = null;
        },

        _makeAuth: function() {
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
        },

        _doOpen: function() {
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
        },

        _doClose: function() {
            if (this._isWebsocket) {
                if (this._connection)
                    this._connection.close();
                this._connection = null;
            }
            return Q();
        },

        sendEvent: function(event) {
            if (this._params) {
                var obj = {};
                for (var name in this._default)
                    obj[name] = this._default[name];
                this._params.forEach(function(p, i) {
                    obj[p] = event[i];
                });
                var blob = JSON.stringify(obj);
            } else {
                var blob = JSON.stringify(event);
            }

            if (this._isWebsocket) {
                if (!this._connection)
                    this._doOpen();
                this._connection.send(blob);
            } else {
                var url = this._url;
                var method = this._method;
                var auth = this._makeAuth();
                Tp.Helpers.Http.request(url, method, blob,
                                        { auth: auth,
                                          useOAuth2: this.device,
                                          dataContentType: 'application/json' })
                    .catch(function(err) {
                        console.error('Error sending event to server: ' + err.message);
                    }).done();
            }
        },
    });

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
        runOAuth2.install(GenericDevice.prototype);
    }
    GenericDevice.runOAuth2 = runOAuth2;

    return GenericDevice;
}

