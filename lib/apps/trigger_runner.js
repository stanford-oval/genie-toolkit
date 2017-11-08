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
    constructor(engine, app, trigger) {
        super();
        this.engine = engine;

        this.app = app;
        this._state = app.state;

        this._trigger = trigger;
        this._once = trigger.once;

        this._env = new ExecWrapper(this.engine, app, app.conversationOutput);
        this._env.triggerInput = this._trigger.input(this._env);
        this._selector = new ChannelOpener(this.engine, this.app, 'r',
                                           this._trigger.selector,
                                           this._trigger.channel,
                                           this._env.triggerInput);

        var self = this;
        this._dataListener = function(data) {
            var from = this;
            self._onTriggerData(from, data);
        };
        this._errorListener = (error) => {
            console.error('Trigger reported error: ' + error.message);
            console.error(error.stack);
            this._env.error(error);
        };
    }

    _onTriggerData(from, data) {
        if (from.__destroyTrigger) {
            this.app.removeSelf();
            return;
        }

        console.log('Handling incoming data on ' + from.uniqueId);
        var env = this._env.clone();
        env.currentChannel = from;
        env.triggerValue = data;

        try {
            if (!this._trigger.filter(env))
                return;
            console.log('Rule triggered');
            this._trigger.output(env);
            this.emit('triggered', env);
            if (this._once)
                this.app.removeSelf();
        } catch(e) {
            console.error('Error during trigger run in ' + this.app.uniqueId + ': ' + e.message);
            console.error(e.stack);
            env.error(e);
        }
    }

    _channelAdded(ch) {
        ch.on('error', this._errorListener);
        ch.on('data', this._dataListener);
        ch.subscribeEvent();
    }

    _channelRemoved(ch) {
        ch.unsubscribeEvent();
        ch.removeListener('data', this._dataListener);
        ch.removeListener('error', this._errorListener);
    }

    stop() {
        return this._selector.stop();
    }

    start() {
        this._selector.on('object-added', this._channelAdded.bind(this));
        this._selector.on('object-removed', this._channelRemoved.bind(this));

        return this._selector.start().catch((e) => {
            console.error('Error while setting up query: ' + e.message);
            console.error(e.stack);
            this._env.error(e);
        });
    }
}
