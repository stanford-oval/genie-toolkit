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

module.exports = class ActionExecutor {
    constructor(engine, app, parent, output) {
        this.engine = engine;
        this.app = app;
        this.output = output;
        this._parent = parent;
        this._invokedAppId = null;
        this.selector = null;

        if (this.output.action) {
            if (this.output.action.kind_type === 'app') {
                this._invokedAppId = this.output.action.selector.name;
            } else {
                this.selector = new ChannelOpener(engine, this.app, 'w',
                                                  this.output.action.selector,
                                                  this.output.action.name);
            }
        }
    }

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
    }

    _getOutputKeyword() {
        return this.engine.keywords.getOpenedKeyword(this.app.uniqueId, this.output.keyword);
    }

    start() {
        if (this._invokedAppId) {
            return this._getInvokedApp();
        } else if (this.selector) {
            return this.selector.start();
        } else {
            return this._getOutputKeyword().then(function(kw) {
                this._outputKeyword = kw;
            }.bind(this));
        }
    }

    stop() {
        if (this.selector) {
            return this.selector.stop();
        } else if (this._outputKeyword) {
            return this._outputKeyword.close();
        }
    }

    execute(env) {
        // keep our parent alive for the duration of the call
        return this._parent.open().then(() => {
            return Q.all(this.output.produce(env))
        }).then((value) => {
            if (this._invokedApp) {
                this._invokeApp(value).catch((e) => {
                    console.error('Failed to execute action: ' + e.message);
                    console.error(e.stack);
                    this.app.reportError(e);
                }).done();
            } else if (this.selector) {
                var channels = this.selector.values();
                channels.forEach((channel) => {
                    Q.try(function() {
                        return channel.sendEvent(value, env);
                    }).catch((e) => {
                        if (e.code === 'ECANCELLED')
                            return;
                        console.error('Failed to execute action: ' + e.message);
                        console.error(e.stack);
                        this.app.reportError(e);
                    }).done();
                });
            } else {
                this._outputKeyword.changeValue(value);
            }
        }).finally(() => {
            return this._parent.close();
        });
    }
}
