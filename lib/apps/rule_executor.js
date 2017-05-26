// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

const TriggerRunner = require('./trigger_runner');
const ChannelOpener = require('./channel_opener');
const RateLimiter = require('../util/rate_limiter');
const ActionExecutor = require('./action_executor');
const QueryExecutor = require('./query_executor');
const RefCounted = require('../util/ref_counted');

module.exports = class RuleExecutor extends RefCounted {
    constructor(engine, app, rule) {
        super();
        this.engine = engine;
        this.app = app;
        this.isRule = true;

        // rate limit to 1 per second, with a burst of 300
        this._rateLimiter = new RateLimiter(300, 300 * 1000);

        this.trigger = new TriggerRunner(engine, this.app, rule.trigger);
        this.trigger.on('triggered', this._onTriggered.bind(this));

        this.queries = rule.queries.map((query) => {
            return new QueryExecutor(engine, app, this, query);
        });
        this.actions = rule.actions.map((out) => {
            return new ActionExecutor(engine, app, this, out);
        });

        this.everything = this.queries.concat(this.actions);
    }

    destroy() {
        return Q.all(this.actions.map((o) => o.destroy()));
    }

    _runQueries(env, cont) {
        var queries = this.queries;
        function loop(env, i) {
            if (i === queries.length)
                return cont(env);

            return queries[i].invoke(env, (env) => loop(env, i+1));
        }
        return loop(env, 0);
    }
    _runActions(env) {
        var actions = this.actions;
        function loop(i) {
            if (i === actions.length)
                return Q();

            return actions[i].execute(env).then(() => loop(i+1));
        }
        return loop(0);
    }

    _onTriggered(env) {
        // check if this trigger was rate limited, and do nothing if so
        // don't even log - as logging could clog the server alone
        if (!this._rateLimiter.hit())
            return;

        this._runQueries(env, (env) => this._runActions(env)).done();
    }

    _doOpen() {
        return Q.all(this.everything.map((out) => out.start()));
    }

    start() {
        return this.trigger.start();
    }

    stop() {
        return this.trigger.stop();
    }

    _doClose() {
        console.log('Closing rule in ' + this.app.uniqueId);
        return Q.all(this.everything.map((out) => out.stop()));
    }
}

