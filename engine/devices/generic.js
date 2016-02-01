// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');
const WebSocket = require('ws');
const Tp = require('thingpedia');

const httpRequestAsync = require('../util/http').request;

module.exports = function(kind, code) {
    var ast = JSON.parse(code);

    const GenericDevice = new lang.Class({
        Name: 'GenericDevice',
        Extends: Tp.BaseDevice,

        _init: function(engine, state) {
            this.parent(engine, state);

            this.globalName = ast['global-name'];
            this.uniqueId = undefined; // let DeviceDatabase pick something

            var params = Object.keys(ast.params);
            if (ast.auth.type === 'oauth2' && Array.isArray(ast.auth.profile))
                params = params.concat(ast.auth.profile);

            this.params = params.map(function(k) { return state[k]; });
            console.log('params', this.params);
            if (ast.name !== undefined)
                this.name = String.prototype.format.apply(ast.name, this.params);
            if (ast.description !== undefined)
                this.description = String.prototype.format.apply(ast.description,
                                                                 this.params);

            if (ast.auth.type === 'oauth2')
                this._isOAuth2 = true;

            console.log('Generic device ' + this.name + ' initialized');
        },

        get accessToken() {
            if (this._isOAuth2)
                return this.state.accessToken;
            else
                return undefined;
        },

        get refreshToken() {
            if (this._isOAuth2)
                return this.state.refreshToken;
            else
                return undefined;
        },

        checkAvailable: function() {
            return Tp.Availability.AVAILABLE;
        },

        hasKind: function(kind) {
            if (ast.types.indexOf(kind) >= 0)
                return true;
            else
                return this.parent(kind);
        },

        queryInterface: function(iface) {
            switch (iface) {
            case 'oauth2':
                if (this._isOAuth2)
                    return this;
                // fallthrough
            default:
                return null;
            }
        },

        refreshCredentials: function() {
            // FINISHME refresh the access token using the refresh token
        },
    });

    const GenericChannel = new lang.Class({
        Name: 'GenericChannel',
        Extends: Tp.BaseChannel,

        _init: function(id, engine, device, params) {
            this.parent();
            this.engine = engine;
            this.device = device;

            var block, source;
            if (id in ast.triggers) {
                block = ast.triggers[id];
                source = true;
            } else if (id in ast.actions) {
                block = ast.actions[id];
                source = false;
            } else {
                console.log('ast', ast);
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

            if (source && !this._isWebsocket) {
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
                return 'Bearer ' + this.device.accessToken;
            } else if (ast.auth.type === 'basic') {
                return 'Basic ' + (new Buffer(this.device.username + ':' +
                                              this.device.password)).toString('base64');
            } else {
                return undefined;
            }
        },

        _emitBlob: function(blob) {
            var parsed = JSON.parse(blob);
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

            return Q.nfcall(httpRequestAsync, url, method, auth, '').then(function(response) {
                try {
                    this._emitBlob(response);
                } catch(e) {
                    console.log('Error parsing server response: ' + e.message);
                    console.log('Full response was');
                    console.log(response);
                    return;
                }
            }.bind(this), function(error) {
                console.log('Error reading from server: ' + error.message);
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
                        console.log('Failed to parse server websocket message: ' + e.message);
                    }
                });
                this._connection.on('error', function(e) {
                    console.log('Error on websocket connection: ' + e.message);
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
                this._connection.send(JSON.stringify(event));
            } else {
                var url = this._url;
                var method = this._method;
                var auth = this._makeAuth();
                httpRequestAsync(url, method, auth, JSON.stringify(event), function(err) {
                    if (err)
                        console.log('Error sending event to server: ' + err.message);
                });
            }
        },
    });

    function OAuthCallback(engine, accessToken, refreshToken) {
        var obj = { kind: kind,
                    accessToken: accessToken,
                    refreshToken: refreshToken };

        if (ast.auth.get_profile) {
            var auth = 'Bearer ' + accessToken;
            return Q.nfcall(httpRequestAsync, ast.auth.get_profile, 'GET',
                            auth, '')
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
    if (ast.auth.type === 'none') {
        runOAuth2 = function runOAuth2(engine) {
            engine.devices.loadOneDevice({ kind: kind }, true);
            return null;
        }
    } else if (ast.auth.type === 'oauth2') {
        runOAuth2 = Tp.Helpers.OAuth2({ kind: kind,
                                        client_id: ast.auth.client_id,
                                        client_secret: ast.auth.client_secret,
                                        authorize: ast.auth.authorize,
                                        get_access_token: ast.auth.get_access_token,
                                        set_state: ast.auth.set_state,
                                        callback: OAuthCallback });
    }

    return {
        createDevice: function(engine, state) {
            return new GenericDevice(engine, state);
        },
        runOAuth2: runOAuth2,
        getSubmodule: function(kind) {
            return {
                createChannel: function(engine, state, params) {
                    return new GenericChannel(kind, engine, state, params);
                }
            }
        }
    };
}

