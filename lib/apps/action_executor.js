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

        if (this.output.action) {
            this.selector = new ChannelOpener(engine, this.app, 'w',
                                              this.output.action.selector,
                                              this.output.action.name);
        } else {
            this.selector = null;
        }
    }

    _getOutputKeyword() {
        return this.engine.keywords.getOpenedKeyword(this.app.uniqueId, this.output.keyword);
    }

    start() {
        if (this.selector) {
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
        } else {
            return this._outputKeyword.close();
        }
    }

    execute(env) {
        // keep our parent alive for the duration of the call
        return this._parent.open().then(() => {
            return Q.all(this.output.produce(env))
        }).then((value) => {
            if (this.selector) {
                var channels = this.selector.values();
                channels.forEach((channel) => {
                    Q.try(function() {
                        return channel.sendEvent(value, env);
                    }).catch((e) => {
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
