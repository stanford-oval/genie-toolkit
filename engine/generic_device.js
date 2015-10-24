// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const http = require('http');
const https = require('https');
const Q = require('q');
const Url = require('url');
const WebSocket = require('ws');

const BaseDevice = require('./base_device');
const BaseChannel = require('./base_channel');
const AppGrammar = require('./app_grammar');
const AppCompiler = require('./app_compiler');
const ExecEnvironment = require('./exec_environment');

function httpRequestAsync(url, method, auth, data, callback) {
    var options = Url.parse(url);
    options.method = method;
    options.headers = {};
    if (method === 'POST')
        options.headers['Content-Type'] = 'application/json';
    if (auth)
        options.headers['Authorization'] = auth;

    var module = options.protocol == 'https:' ? https : http;
    var req = module.request(options, function(res) {
        if (res.statusCode >= 400)
            return callback(new Error(http.STATUS_CODES[res.statusCode]));

        var data = '';
        res.setEncoding('utf8');
        res.on('data', function(chunk) {
            data += chunk;
        });
        res.on('end', function() {
            callback(null, data);
        });
    });
    req.on('error', function(err) {
        callback(err);
    });
    req.end(data);
}

module.exports = function(kind, code) {
    var compiler = new AppCompiler();
    var ast = AppGrammar.parse(code, { startRule: 'device_description' });

    compiler.compileAtRules(ast['at-rules']);
    var auth = compiler.auth || { type: 'none' };
    var channels = compiler.compileChannelDescriptions(ast.channels);

    const GenericDevice = new lang.Class({
        Name: 'GenericDevice',
        Extends: BaseDevice,

        _init: function(engine, state) {
            this.parent(engine, state);

            this.uniqueId = undefined; // let DeviceDatabase pick something

            var stateProps = Object.keys(state).map(function(k) { return state[k]; });
            this.name = String.prototype.format.apply(compiler.name, stateProps);
            this.description = String.prototype.format.apply(compiler.description, stateProps);

            if (auth.type == 'oauth2')
                this._isOAuth2 = true;
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
            return BaseDevice.Availability.AVAILABLE;
        },

        hasKind: function(kind) {
            if (compiler.kinds.indexOf(kind) >= 0)
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
        Extends: BaseChannel,

        _init: function(kind, engine, device) {
            this.parent();
            this.engine = engine;
            this.device = device;

            var channelBlock = null;
            for (var i = 0; i < channels.length; i++) {
                if (channels[i].kind === kind) {
                    channelBlock = channels[i];
                    break;
                }
            }
            if (channelBlock === null)
                throw new Error('Invalid channel ' + kind);

            var env = new ExecEnvironment(engine.devices, device.state);
            env.beginOutput();
            channelBlock.properties.forEach(function(prop) {
                prop(env);
            });

            this._properties = env.finishOutput();

            if (kind === 'sink') {
                this._properties.source = false;
            } else if (kind === 'source') {
                this._properties.source = true;
            } else {
                if (!'source' in this._properties)
                    throw new Error('Must specify source flag for custom endpoints');
            }

            if (!('url' in this._properties))
                throw new Error('Must specify endpoint url');
            if (this._properties.url.startsWith('ws')) {
                this._isWebsocket = true;
                this._properties.url = 'http' + this._properties.url.substr(2);
            } else {
                this._isWebsocket = false;
            }

            if (!('method' in this._properties)) {
                if (this._properties.source)
                    this._properties.method = 'GET';
                else
                    this._properties.method = 'POST';
            }

            if (this._properties.source && !this._isWebsocket) {
                if ('poll-interval' in this._properties)
                    this._pollInterval = this._properties['poll-interval'];
                else
                    this._pollInterval = 300000; // 5m
            } else {
                this._pollInterval = -1;
            }

            this._connection = null;
            this._timeout = -1;
        },

        _makeAuth: function() {
            if (auth.type === 'none') {
                return undefined;
            } else if (auth.type === 'oauth2') {
                return 'Bearer ' + this.device.accessToken;
            } else if (auth.type === 'basic') {
                return 'Basic ' + (new Buffer(device.username + ':' + device.password)).toString('base64');
            } else {
                return undefined;
            }
        },

        _onTick: function() {
            var channelInstance = this;
            var url = this._properties.url;
            var method = this._properties.method;
            var auth = this._makeAuth();

            return Q.nfcall(httpRequestAsync, url, method, auth, '').then(function(response) {
                try {
                var parsed = JSON.parse(response);
                channelInstance.emitEvent(parsed);
            } catch(e) {
                console.log('Error parsing server response: ' + e.message);
                console.log('Full response was');
                console.log(response);
                return;
            }
            }, function(error) {
                console.log('Error reading from server: ' + error.message);
            });
        },

        _doOpen: function() {
            if (this._isWebsocket) {
                var auth = this._makeAuth();
                var headers = {};
                if (auth)
                    headers['Authorization'] = auth;
                this._connection = new WebSocket(this._properties.url, { headers: headers });
                this._connection.on('message', function(data) {
                    try {
                        var parsed = JSON.parse(data);
                        this.emitEvent(parsed);
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
            } else if (this._properties.source) {
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
            } else if (this._properties.source) {
                clearInterval(this._timeout);
                this._timeout = -1;
            }
            return Q();
        },

        sendEvent: function(event) {
            if (this._isWebsocket) {
                if (!this._connection)
                    this._doOpen();
                this._connection.send(JSON.stringify(event));
            } else {
                var url = this._properties.url;
                var method = this._properties.method;
                var auth = this._makeAuth();
                httpRequestAsync(url, method, auth, JSON.stringify(event), function(err) {
                    console.log('Error sending event to server: ' + err.message);
                });
            }
        },
    });

    return {
        createDevice: function(engine, state) {
            return new GenericDevice(engine, state);
        },
        runOAuth2: function(engine, req) {
            if (auth.type === 'none') {
                engine.devices.loadOneDevice({ kind: kind }, true);
                return null;
            } else {
                // FINISHME
            }
        },
        getSubmodule: function(kind) {
            return {
                createChannel: function(engine, state) {
                    return new GenericChannel(kind, engine, state);
                }
            }
        }
    };
}

