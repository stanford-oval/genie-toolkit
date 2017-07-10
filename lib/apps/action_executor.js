// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015-2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

const ChannelOpener = require('./channel_opener');
const ExecEnvironment = require('thingtalk').ExecEnvironment;

module.exports = class ActionExecutor {
    constructor(engine, app, parent, action) {
        this.engine = engine;
        this.app = app;
        this.action = action;
        this._parent = parent;
        this.selector = new ChannelOpener(engine, this.app, 'w',
                                          this.action.selector,
                                          this.action.channel);
        this._queue = null;
    }

    destroy() {
        if (this.selector === null)
            return;
        if (!this.selector.isRemote)
            return;

        // HACK HACK HACK
        // make up an empty environment
        var env = new ExecEnvironment(this.engine.platform.locale, this.engine.platform.timezone);
        var [principal, uuid] = this.action.input(env);
        return this.engine.remote.sendData(principal, uuid, null);
    }

    /*
    _getInvokedApp() {
        return this.engine.schemas.getSchemaAndNames(this._invokedAppId, 'actions', 'invoke').then((schema) => {
            this._invokedApp = schema;
        });
    }

    _invokeApp(event) {
        var state = {};

        this._invokedApp.args.forEach((name, i) => {
            if (event[i] instanceof Date)
                state[name] = event[i].getTime();
            else
                state[name] = event[i];
        });

        state.$icon = 'app:' + this._invokedAppId;
        return this.engine.schemas.getAppCode(this._invokedAppId).then((app) => {
            return this.engine.apps.loadOneApp(app.code, state, undefined, undefined, app.name, app.description, true);
        });
    }*/

    start() {
        if (this._invokedAppId) {
            return this._getInvokedApp();
        } else {
            return this.selector.start();
        }
    }

    stop() {
        if (this.selector) {
            return this.selector.stop();
        }
    }

    execute(env) {
        return this._addToQueue(env);
    }

    _addToQueue(env) {
        if (this._queue)
            return this._queue = this._queue.then(() => this._runOne(env));
        else
            return this._queue = this._runOne(env);
    }

    _runOne(env) {
        // keep our parent alive for the duration of the call

        return this._parent.open().then(() => {
            return Q.all(this.action.input(env));
        }).then((value) => {
            if (this._invokedApp) {
                this._invokeApp(value).catch((e) => {
                    console.error('Failed to execute action: ' + e.message);
                    console.error(e.stack);
                    this.app.reportError(e);
                }).done();
            } else if (this.selector) {
                var channels = this.selector.values();
                return Q.all(channels.map((channel) => {
                    return Q.try(function() {
                        return channel.sendEvent(value, env);
                    }).catch((e) => {
                        if (e.code === 'ECANCELLED')
                            return;
                        console.error('Failed to execute action: ' + e.message);
                        console.error(e.stack);
                        this.app.reportError(e);
                    });
                }));
            }
        }).finally(() => {
            return this._parent.close();
        });
    }
}
