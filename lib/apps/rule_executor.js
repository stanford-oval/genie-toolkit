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

class QueryExecutor {
    constructor(engine, app, query) {
        this.engine = engine;
        this.app = app;

        this._keywords = [];
        this._keywordAsts = {};
        this._query = query;
        this._selector = new ChannelOpener(this.engine, this.app, 'q',
                                           query.invocation.selector,
                                           query.invocation.name);
    }

    invoke(env, cont) {
        var args = this._query.invocation.params.map(function(f) {
            return f(env);
        });

        this._selector.values().forEach(function(ch) {
            Q.try(function() {
                return Q(ch.invokeQuery(args)).then(function(rows) {
                    rows.forEach(function(row) {
                        var clone = env.clone();
                        clone.currentChannel = ch;
                        clone.queryInput = args;
                        clone.queryValue = row;
                        this._query.caller(clone, function() {
                            return cont(clone);
                        });
                    }, this);
                }.bind(this));
            }.bind(this)).catch(function(e) {
                console.error('Error during query run in ' + this.app.uniqueId + ': ' + e.message);
                console.error(e.stack);
                this.app.reportError(e);
            }.bind(this));
        }, this);
    }

    stop() {
        return this._selector.stop();
    }

    start() {
        return this._selector.start().catch(function(e) {
            console.error('Error while setting up query: ' + e.message);
            console.error(e.stack);
            this.app.reportError(e);
        }.bind(this));
    }
}

module.exports = class RuleExecutor {
    constructor(engine, app, rule) {
        this.engine = engine;
        this.app = app;
        // rate limit to 1 per second, with a burst of 300
        this._rateLimiter = new RateLimiter(300, 300 * 1000);

        this.input = new TriggerRunner(engine, this.app, rule.inputs);
        this.input.on('triggered', this._onTriggered.bind(this));

        this.queries = rule.queries.map(function(query) {
            return new QueryExecutor(engine, app, query);
        });
        this.outputs = rule.outputs.map(function(out) {
            return new ActionExecutor(engine, app, out);
        });

        this.everything = this.queries.concat(this.outputs);
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

        this._runQueries(env, function(env) {
            this.outputs.forEach(function(out) {
                out.execute(env);
            });
        }.bind(this));
    }

    start() {
        return Q.try(function() {
            return Q.all(this.everything.map(function(out) {
                return out.start();
            }));
        }.bind(this)).then(function() {
            this.input.start().done();
        }.bind(this));
    }

    stop() {
        return this.input.stop().then(function() {
            return Q.all(this.everything.map(function(out) {
                return out.stop();
            }));
        }.bind(this));
    }
}

