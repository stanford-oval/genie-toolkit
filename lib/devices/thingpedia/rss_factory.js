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

const GenericRSSTrigger = new Tp.ChannelClass({
    Name: 'GenericRSSTrigger',
    Extends: Tp.RSSPollingTrigger,
    RequiredCapabilities: ['channel-state'],

    _init: function(id, engine, state, device, params) {
        this.parent(engine, state, device);

        console.log('Initializing generic RSS channel ' + id);

        var ast = this.device.constructor.metadata;

        var block;
        if (id in ast.triggers) {
            block = ast.triggers[id];
        } else {
            throw new Error('Invalid channel ' + id);
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

        this.auth = this._makeAuth(ast);
        this.useOAuth2 = this.device;
    },

    _makeAuth: function(ast) {
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
        var updated = event[2];
        return [{
            type: 'rdl',
            what: 'post',
            displayTitle: title,
            callback: link,
            webCallback: link
        }];
    },

    _emit: function(entry) {
        this.emitEvent([entry[0], entry[1], entry[3]]);
    }
});

const GenericRSSQuery = new Tp.ChannelClass({
    Name: 'GenericRSSQuery',

    _init: function(id, engine, device, params) {
        this.parent(engine, device);

        console.log('Initializing generic RSS query channel ' + id);

        var ast = this.device.constructor.metadata;

        var block;
        if (id in ast.queries) {
            block = ast.queries[id];
        } else {
            throw new Error('Invalid channel ' + id);
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

        this.auth = this._makeAuth(ast);
    },

    _makeAuth: function(ast) {
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
        var updated = event[2];
        return [{
            type: 'rdl',
            what: 'post',
            displayTitle: title,
            callback: link,
            webCallback: link
        }];
    },

    invokeQuery(filters) {
        return Tp.Helpers.Http.get(this.url, { auth: this.auth, useOAuth2: this.device }).then((response) => {
            return Tp.Helpers.Xml.parseString(response);
        }).then((parsed) => {

            var toEmit = [];
            if (parsed.feed) {
                for (var entry of parsed.feed.entry) {
                    var updated = new Date(entry.updated[0]);
                    toEmit.push([entry.title[0], entry.link[0].$.href, updated]);
                }
            } else {
                for (var entry of parsed.rss.channel[0].item) {
                    var updated = new Date(entry.pubDate[0]);
                    toEmit.push([entry.title[0], entry.link[0], updated]);
                }
            }

            toEmit.sort(function(a, b) {
                return (+b[2]) - (+a[2]);
            });

            return toEmit;
        });
    }
});

function makeOAuth(ast, devclass) {
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

module.exports = class RSSModule {
    constructor(kind, ast) {
        this._id = kind;
        this._manifest = ast;
        var isNoneFactory = ast.auth.type === 'none' && Object.keys(ast.params).length === 0;
        var isNoneAuth = ast.auth.type === 'none';

        this._loaded = new Tp.DeviceClass({
            Name: 'GenericRSSDevice',

            _init(engine, state) {
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

                console.log('RSS device ' + this.name + ' initialized');
            },

            checkAvailable() {
                return Tp.Availability.AVAILABLE;
            },

            getTriggerClass(kind) {
                if (!(kind in ast.triggers))
                    throw new Error('Invalid channel name ' + kind);
                return {
                    requiredCapabilities: ['channel-state'],

                    createChannel: function(engine, state, device, params) {
                        return new GenericRSSTrigger(kind, engine, state, device, params);
                    }
                }
            },

            getQueryClass(kind) {
                if (!(kind in ast.queries))
                    throw new Error('Invalid channel name ' + kind);
                return {
                    requiredCapabilities: [],

                    createChannel: function(engine, state, device, params) {
                        return new GenericRSSQuery(kind, engine, state, device, params);
                    }
                }
            },

            getActionClass(kind) {
                // can't have actions for RSS feeds
                throw new Error('Invalid channel name ' + kind);
            }
        });
        this._loaded.metadata = ast;
        if (ast.auth.type === 'oauth2')
            makeOAuth(ast, this._loaded);
    }

    get id() {
        return this._id;
    }
    get manifest() {
        return this._manifest;
    }
    get version() {
        return 0; // version does not matter for builtin
    }

    clearCache() {
        // nothing to do here
    }

    getDeviceFactory() {
        return this._loaded;
    }
};
