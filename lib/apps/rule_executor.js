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

        this.input = new TriggerRunner(engine, this.app, rule.inputs);
        this.input.on('triggered', this._onTriggered.bind(this));

        this.queries = rule.queries.map((query) => {
            return new QueryExecutor(engine, app, this, query);
        });
        this.outputs = rule.outputs.map((out) => {
            return new ActionExecutor(engine, app, this, out);
        });

        this.everything = this.queries.concat(this.outputs);
    }

    destroy() {
        return Q.all(this.outputs.map((o) => o.destroy()));
    }

    _runQueries(env, cont) {
        function loop(queries, env, i, cont) {
            if (i === queries.length)
                return cont(env);

            return queries[i].invoke(env, function(env) {
                return loop(queries, env, i+1, cont);
            });
        }

        return loop(this.queries, env, 0, cont);
    }

    _onTriggered(env) {
        // check if this trigger was rate limited, and do nothing if so
        // don't even log - as logging could clog the server alone
        if (!this._rateLimiter.hit())
            return;

        this._runQueries(env, (env) => {
            this.outputs.forEach((out) => {
                out.execute(env);
            });
        });
    }

    _doOpen() {
        return Q.all(this.everything.map((out) => {
            return out.start();
        }));
    }

    start() {
        this.input.start().done();
    }

    stop() {
        return this.input.stop();
    }

    _doClose() {
        console.log('Closing rule in ' + this.app.uniqueId);
        return Q.all(this.everything.map((out) => {
            return out.stop();
        }));
    }
}

