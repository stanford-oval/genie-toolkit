// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

const AsyncQueue = require('./async_queue');
const RateLimiter = require('../util/rate_limiter');

module.exports = class TriggerRunner {
    constructor(env, selector) {
        this._env = env;
        this._selector = selector;

        // rate limit to 1 per second, with a burst of 300
        this._rateLimiter = new RateLimiter(300, 300 * 1000);

        var self = this;
        this._dataListener = function(data) {
            var from = this;
            self._onTriggerData(from, data);
        };
        this._endListener = function() {
            var from = this;
            self._onTriggerEnd(from);
        }
        this._errorListener = function(error) {
            var from = this;
            self._onTriggerError(from, error);
        };

        this._ended = new Set;
        this._stopped = false;
        this._queue = new AsyncQueue();
    }

    next() {
        return this._queue.pop();
    }

    _onTriggerError(from, error) {
        this._env.reportError('Trigger ' + from.uniqueId + ' reported an error', error);
    }

    _onTriggerData(from, data) {
        if (this._stopped)
            return;
        if (!this._rateLimiter.hit())
            return;

        console.log('Handling incoming data on ' + from.uniqueId);

        this._queue.push({ done: false, value: [this._env.getEventType(from), from, data] });
    }

    _onTriggerEnd(from) {
        console.log('Handling trigger end from ' + from.uniqueId);
        if (this._stopped)
            return;
        this._ended.add(from);
        if (this._ended.size == this._selector.values().length) {
            this._stopped = true;
            this._queue.push({ done: true });
        }
    }

    _channelAdded(ch) {
        ch.on('error', this._errorListener);
        ch.on('end', this._endListener);
        ch.on('data', this._dataListener);
        ch.subscribeEvent();
    }

    _channelRemoved(ch) {
        ch.unsubscribeEvent();
        ch.removeListener('data', this._dataListener);
        ch.removeListener('end', this._endListener);
        ch.removeListener('error', this._errorListener);
    }

    end() {
        if (this._stopped)
            return;
        this._stopped = true;
        this._queue.push({ done: true });
    }

    stop() {
        this._stopped = true;
        this._selector.stop().catch((e) => console.error(e));
    }

    start() {
        this._selector.on('object-added', this._channelAdded.bind(this));
        this._selector.on('object-removed', this._channelRemoved.bind(this));

        return this._selector.start();
    }
}
