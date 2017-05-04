// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const ExecWrapper = require('./exec_wrapper');
const ChannelOpener = require('./channel_opener');

module.exports = class TriggerRunner extends events.EventEmitter {
    constructor(engine, app, input) {
        super();
        this.engine = engine;

        this.app = app;
        this._state = app.state;

        this._trigger = input.invocation;
        this._input = input;
        this._once = input.once;

        if (this._trigger) {
            this._selector = new ChannelOpener(this.engine, this.app, 'r',
                                               this._trigger.selector,
                                               this._trigger.name,
                                               this._normalizeParams(this._trigger.params));
        } else {
            this._selector = null;
        }

        this._env = new ExecWrapper(this.engine, app, input.keywords);

        this._ready = false;
    }

    _normalizeParams(params) {
        return params.map((p) => {
            if (p === undefined)
                return undefined;
            if (p === null)
                return null;
            if (p.isConstant) {
                return Ast.valueToJS(p.value);
            } else if (p.isVarRef) {
                var type = this.app.compiler.params[p.name];
                var value = this.app.state[p.name];
                if (type.isDate) {
                    var date = new Date();
                    date.setTime(value);
                    return date;
                } else {
                    return value;
                }
            } else
                throw new TypeError();
        });
    }

    _onTriggerData(from) {
        if (from.__destroyTrigger) {
            this.engine.apps.removeApp(this.app);
            return;
        }
        if (from.event === null) // fast path
            return;

        console.log('Handling incoming data on ' + from.uniqueId);
        var env = this._env.clone();
        env.currentChannel = from;
        env.triggerValue = from.event;

        this._checkQuery(env);
    }

    _onInitialSample() {
        if (this._selector) {
            this._selector.values().forEach(function(ch) {
                this._onTriggerData(ch);
            }, this);
        } else {
            var env = this._env.clone();
            this._checkQuery(env);
        }
    }

    _checkQuery(env) {
        try {
            this._input.caller(env, () => {
                console.log('Rule triggered');
                this.emit('triggered', env);
                if (this._once)
                    this.engine.apps.removeApp(this.app);
            });
        } catch(e) {
            console.error('Error during trigger run in ' + this.app.uniqueId + ': ' + e.message);
            console.error(e.stack);
            this.app.reportError(e);
        }
    }

    _channelAdded(ch) {
        ch.on('data', this._dataListener);

        // if this channel was added when the query was already running sample the new data
        // from it
        if (this._ready)
            this._onTriggerData(ch);
    }

    _channelRemoved(ch) {
        ch.removeListener('data', this._dataListener);
    }

    stop() {
        return this._selector.stop().then(() => {
            return this._env.stop();
        });
    }

    start() {
        var self = this;
        this._dataListener = function(data) {
            var from = this;
            self._onTriggerData(from, data);
        };

        return this._env.start().then(function() {
            this._selector.on('object-added', this._channelAdded.bind(this));
            this._selector.on('object-removed', this._channelRemoved.bind(this));

            return this._selector.start();
        }.bind(this)).catch(function(e) {
            console.error('Error while setting up query: ' + e.message);
            console.error(e.stack);
            this.app.reportError(e);
        }.bind(this)).then(function() {
            this._ready = true;
            this._onInitialSample();
            this.emit('ready');
        }.bind(this));
    }
}
