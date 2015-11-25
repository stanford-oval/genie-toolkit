// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const lang = require('lang');
const fs = require('fs');
const events = require('events');
const uuid = require('node-uuid');

const httpRequestAsync = require('./util/http').request;
const prefs = require('./prefs');

const UICallback = new lang.Class({
    Name: 'UICallback',

    _init: function(engine, ui, appId) {
        this.engine = engine;
        this.ui = ui;
        this.appId = appId;

        this._listener = this.invoke.bind(this);
    },

    invoke: function() {
        throw new Error('Not Implemented');
    },

    open: function() {
        return this.ui.getNotify(this.appId).then(function(pipe) {
            this._pipe = pipe;
            pipe.on('data', this._listener);
        });
    },

    close: function() {
        this._pipe.removeListener('data', this._listener);
        return this._pipe.close();
    },
});

const WebHookCallback = new lang.Class({
    Name: 'WebHookCallback',
    Extends: UICallback,

    _init: function(engine, ui, blob) {
        this.parent(engine, ui, blob.appId);

        this.url = blob.url;
        this.auth = blob.auth;
    },

    invoke: function(event) {
        httpRequestAsync(this.url, 'POST', this.auth, JSON.stringify(event),
                         function(err) {
                             console.log('Failed to send event to UI: ' + err.message);
                             // eat the error otherwise
                         });
    }
});

const OmletRDLCallback = new lang.Class({
    Name: 'OmletRDLCallback',
    Extends: UICallback,

    _init: function(engine, ui, blob) {
        this.parent(engine, ui, blob.appId);

        this.feedId = blob.feedId;
        this.rdl = blob.rdl;
        this.callback = this.rdl.callback;
    },

    invoke: function(event) {
        var fullCallback = this.callback +
            new Buffer(JSON.stringify(event)).toString('base64');
        this.rdl.callback = fullCallback;
        this.rdl.type = 'app';
        this._feed.sendRaw(this.rdl);
    },

    open: function() {
        this._feed = this.engine.messaging.getFeed(this.feedId);
        return Q.all([this._feed.open(),
                      this.parent()]);
    },

    close: function() {
        return Q.all([this.parent(),
                      this._feed.close()]);
    },
});

module.exports = new lang.Class({
    Name: 'UIManager',
    $rpcMethods: ['getInput', 'getNotify', 'registerCallback'],

    _init: function(engine) {
        events.EventEmitter.call(this);

        this.engine = engine;

        this._db = new prefs.FilePreferences(platform.getWritableDir() +
                                             '/callbacks.db');
        this._callbacks = {};
    },

    getInput: function(appId) {
        return this.engine.channels.getNamedPipe('thingengine-app-' +
                                                 appId + '-input', 'w');
    },

    getNotify: function(appId) {
        return this.engine.channels.getNamedPipe('thingengine-app-' +
                                                 appId + '-notify', 'r');
    },

    registerCallback: function(blob) {
        var cb = this._loadCallback(blob);
        var id = uuid.v4();
        this._db.set(id, blob);
        this._openCallback(cb).done();
        return id;
    },

    unregisterCallback: function(id) {
        this._callbacks[id].close().done();
        delete this._callbacks[id];
        this._db.set(id, undefined);
    },

    _loadCallback: function(blob) {
        switch (blob.kind) {
        case 'webhook':
            return new WebHookCallback(this.engine, this, blob);
        case 'omlet-rdl':
            return new OmletRDLCallback(this.engine, this, blob);
        default:
            throw new TypeError('Invalid callback type');
        }
    },

    _openCallback: function(id, callback) {
        this._callbacks[id] = callback;
        return callback.open().then(function() { return callback; });
    },

    start: function() {
        var keys = this._db.keys();

        return Q.all(keys.map(function(k) {
            var value = this._db.get(k);
            var cb = this._loadCallback(value);
            return this._openCallback(cb);
        }, this));
    },

    stop: function() {
        var keys = Object.keys(this._callbacks);

        return Q.all(keys.map(function(k) {
            return this._callbacks[k].close();
        }, this));
    },
});
