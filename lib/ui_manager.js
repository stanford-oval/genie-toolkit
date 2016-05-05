// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const uuid = require('node-uuid');
const Tp = require('thingpedia');

const prefs = require('./util/prefs');

class UICallback {
    constructor(engine, ui, appId) {
        this.engine = engine;
        this.ui = ui;
        this.appId = appId;

        this._listener = this.invoke.bind(this);
    }

    invoke() {
        throw new Error('Not Implemented');
    }

    open() {
        return this.ui.getNotify(this.appId).then(function(pipe) {
            this._pipe = pipe;
            pipe.on('data', this._listener);
        });
    }

    close() {
        this._pipe.removeListener('data', this._listener);
        return this._pipe.close();
    }
}

class WebHookCallback extends UICallback {
    constructor(engine, ui, blob) {
        super(engine, ui, blob.appId);

        this.url = blob.url;
        this.auth = blob.auth;
    }

    invoke(event) {
        Tp.Helpers.Http.post(this.url, JSON.stringify(event),
                             { auth: this.auth }).
            catch(function(err) {
                console.error('Failed to send event to UI: ' + err.message);
                // eat the error otherwise
            }).done();
    }
}

class OmletRDLCallback extends UICallback {
    constructor(engine, ui, blob) {
        this.parent(engine, ui, blob.appId);

        this.feedId = blob.feedId;
        this.rdl = blob.rdl;
        this.callback = this.rdl.callback;
    }

    invoke(event) {
        var fullCallback = this.callback +
            new Buffer(JSON.stringify(event)).toString('base64');
        this.rdl.callback = fullCallback;
        this.rdl.type = 'app';
        this._feed.sendRaw(this.rdl);
    }

    open() {
        this._feed = this.engine.messaging.getFeed(this.feedId);
        return Q.all([this._feed.open(),
                      this.parent()]);
    }

    close() {
        return Q.all([this.parent(),
                      this._feed.close()]);
    }
}

// These are identical to the copies in AppExecutor, but they are
// reversed: a @$notify becomes a read channel, @$input becomes a write
// channel
const AppInputChannel = new Tp.ChannelClass({
    Name: 'AppInputChannel',

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

const AppNotifyChannel = new Tp.ChannelClass({
    Name: 'AppNotifyChannel',

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

module.exports = class UIManager {
    constructor(engine) {
        this.engine = engine;

        this._db = new prefs.FilePreferences(engine.platform.getWritableDir() +
                                             '/callbacks.db');
        this._callbacks = {};
    }

    getInput(appId) {
        var channel = new AppInputChannel(this.engine, this.engine.apps.getApp(appId));
        return channel.open().then(function() { return channel; });
    }

    getAllInput() {
        return this.engine.channels.getNamedPipe('thingengine-app-input', 'w');
    }

    getNotify(appId) {
        var channel = new AppReturnChannel(this.engine, this.engine.apps.getApp(appId));
        return channel.open().then(function() { return channel; });
    }

    getAllNotify() {
        return this.engine.channels.getNamedPipe('thingengine-app-notify', 'r');
    }

    registerCallback(blob) {
        var cb = this._loadCallback(blob);
        var id = uuid.v4();
        this._db.set(id, blob);
        this._openCallback(cb).done();
        return id;
    }

    unregisterCallback(id) {
        this._callbacks[id].close().done();
        delete this._callbacks[id];
        this._db.set(id, undefined);
    }

    _loadCallback(blob) {
        switch (blob.kind) {
        case 'webhook':
            return new WebHookCallback(this.engine, this, blob);
        case 'omlet-rdl':
            return new OmletRDLCallback(this.engine, this, blob);
        default:
            throw new TypeError('Invalid callback type');
        }
    }

    _openCallback(id, callback) {
        this._callbacks[id] = callback;
        return callback.open().then(function() { return callback; });
    }

    start() {
        var keys = this._db.keys();

        return Q.all(keys.map(function(k) {
            var value = this._db.get(k);
            var cb = this._loadCallback(value);
            return this._openCallback(cb);
        }, this));
    }

    stop() {
        var keys = Object.keys(this._callbacks);

        return Q.all(keys.map(function(k) {
            return this._callbacks[k].close();
        }, this));
    }
}
module.exports.prototype.$rpcMethods = ['getInput', 'getNotify', 'registerCallback', 'unregisterCallback'];
