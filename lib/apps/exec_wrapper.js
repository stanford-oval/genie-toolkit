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
const ExecEnvironment = ThingTalk.ExecEnvironment;
const ChannelOpener = require('./channel_opener');
const TimedReference = require('../util/timed_ref');
const TriggerRunner = require('./trigger_runner');

function safeInvoke(promise) {
    return Promise.resolve(promise).then((x) => x, (e) => {
        if (e.code === 'ECANCELLED')
            return [];
        else
            throw e;
    });
}

module.exports = class ExecWrapper extends ExecEnvironment {
    constructor(engine, app, functions, output) {
        super(engine.platform.locale, engine.platform.timezone);
        this.engine = engine;
        this.app = app;
        this._output = output;

        for (let name in this.app.state) {
            if (name.startsWith('$'))
                continue;
            var type = this.app.compiler.params[name];
            var value = this.app.state[name];
            this._scope[name] = Ast.Value.fromJSON(type, value).toJS();
        }

        this._functions = functions;
        this._trigger = null;
        this._channels = new Array(this._functions.length);

        this._execCache = [];
    }

    _acquireFunction(fnid, params) {
        // keep channels open for 30 seconds
        const fn = this._functions[fnid];

        if (!this._channels[fnid])
            this._channels[fnid] = new TimedReference(30000, false, (opener) => opener.stop());

        return this._channels[fnid].acquire(() => {
            let channelOpener = new ChannelOpener(this.engine, this.app,
                                                  fn.type,
                                                  fn.selector,
                                                  fn.channel,
                                                  params);
            return channelOpener.start().then(() => channelOpener);
        });
    }

    _releaseFunction(fnid) {
        return this._channels[fnid].release();
    }

    stopTrigger() {
        if (this._trigger)
            this._trigger.stop();
    }

    releaseAll() {
        for (let i = 0; i < this._channels.length; i++) {
            if (this._channels[i])
                this._channels[i].releaseNow();
        }
    }

    invokeTrigger(fnid, params) {
        const fn = this._functions[fnid];

        let channelOpener = new ChannelOpener(this.engine, this.app,
                                              fn.type,
                                              fn.selector,
                                              fn.channel,
                                              params);
        this._trigger = new TriggerRunner(this, channelOpener);
        return this._trigger.start().then(() => this._trigger);
    }


    _findInCache(fnid, params) {
        const fn = this._functions[fnid];

        for (let cached of this._execCache) {
            let [kind, channel, cachedparams, result] = cached;
            if (kind === fn.selector.kind && channel === fn.channel &&
                ThingTalk.Builtin.equality(cachedparams, params))
                return result;
        }

        return null;
    }

    invokeQuery(fnid, params) {
        let cached = this._findInCache(fnid, params);
        if (cached)
            return Q(cached);

        const fn = this._functions[fnid];
        return this._acquireFunction(fnid, params).then((channelOpener) => {
            let channels = channelOpener.values();

            return Q.all(channels.map((c) => safeInvoke(c.invokeQuery(params)))).then((results) => {
                let list = [];
                results.forEach((result, i) => {
                    let channel = channels[i];
                    let outputType = this.getEventType(channel);

                    for (let element of result) {
                        list.push([outputType, channel, element]);
                    }
                });

                this._execCache.push([fn.selector.kind, fn.channel, params, list]);
                return list;
            });
        }).finally(() => {
            return this._releaseFunction(fnid);
        });
    }

    invokeAction(fnid, params) {
        return this._acquireFunction(fnid, params).then((channelOpener) => {
            let channels = channelOpener.values();

            return Q.all(channels.map((c) => safeInvoke(c.sendEvent(params, this))));
        }).finally(() => {
            return this._releaseFunction(fnid);
        });
    }

    sendEndOfFlow(principal, uuid) {
        return this.engine.remote.sendData(principal, uuid, null);
    }

    clearGetCache() {
        this._execCache.length = 0;
    }

    get icon() {
        return this.app.icon;
    }

    reportError(message, error) {
        console.error(message);
        this.app.error = error;
        return this._output.error(this.icon, error);
    }

    output(outputType, outputValues, currentChannel) {
        return this._output.output(this.icon, outputType, outputValues, currentChannel);
    }

    say(message) {
        return this._output.say(this.icon, message);
    }

    askQuestion(type, question) {
        return this._output.question(this.icon, type, question);
    }
}
