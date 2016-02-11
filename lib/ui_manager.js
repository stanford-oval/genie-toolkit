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
const Tp = require('thingpedia');

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
        Tp.Helpers.Http.post(this.url, JSON.stringify(event),
                             { auth: this.auth }).
            catch(function(err) {
                console.error('Failed to send event to UI: ' + err.message);
                // eat the error otherwise
            }).done();
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

// These are identical to the copies in AppExecutor, but they are
// reversed: a @$notify becomes a read channel, @$input becomes a write
// channel
const AppInputChannel = new lang.Class({
    Name: 'AppInputChannel',
    Extends: Tp.BaseChannel,

    _init: function(engine, app) {
        this.parent();
        this.engine = engine;
        this._app = app;
        this._inner = null;
    },

    sendEvent: function(event) {
        this._inner.sendEvent([this._app.uniqueId, event]);
    },

    _doOpen: function() {
        return this.engine.channels.getNamedPipe('thingengine-app-input', 'w')
            .then(function(ch) {
                this._inner = ch;
            }.bind(this));
    },

    _doClose: function() {
        return this._inner.close();
    },
});

const AppNotifyChannel = new lang.Class({
    Name: 'AppNotifyChannel',
    Extends: Tp.BaseChannel,

    _init: function(engine, app) {
        this.parent();
        this.engine = engine;
        this._app = null;

        this._inner = null;
        this._listener = this._onEvent.bind(this);
    },

    _onEvent: function(data) {
        var app = data[0];
        var event = data[1];
        if (app === this._app.uniqueId)
            this.emitEvent(event);
    },

    _doOpen: function() {
        return this.engine.channels.getNamedPipe('thingengine-app-notify', 'r')
            .then(function(ch) {
                this._inner = ch;
                this._inner.on('data', this._listener);
            }.bind(this));
    },

    _doClose: function() {
        this._inner.removeListener('data', this._listener);
        return this._inner.close();
    },
});

module.exports = new lang.Class({
    Name: 'UIManager',
    $rpcMethods: ['getInput', 'getNotify', 'registerCallback', 'unregisterCallback'],

    _init: function(engine) {
        events.EventEmitter.call(this);

        this.engine = engine;

        this._db = new prefs.FilePreferences(platform.getWritableDir() +
                                             '/callbacks.db');
        this._callbacks = {};
    },

    getInput: function(appId) {
        var channel = new AppInputChannel(this.engine, this.engine.apps.getApp(appId));
        return channel.open().then(function() { return channel; });
    },

    getAllInput: function() {
        return this.engine.channels.getNamedPipe('thingengine-app-input', 'w');
    },

    getNotify: function(appId) {
        var channel = new AppReturnChannel(this.engine, this.engine.apps.getApp(appId));
        return channel.open().then(function() { return channel; });
    },

    getAllNotify: function() {
        return this.engine.channels.getNamedPipe('thingengine-app-notify', 'r');
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
