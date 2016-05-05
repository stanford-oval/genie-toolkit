// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const events = require('events');
const lang = require('lang');
const adt = require('adt');
const Tp = require('thingpedia');

const ThingTalk = require('thingtalk');
const AppGrammar = ThingTalk.Grammar;
const AppCompiler = ThingTalk.Compiler;
const TriggerRunner = require('./trigger_runner');
const ChannelOpener = require('./devices/channel_opener');
const ComputeModule = require('./compute_module');
const RateLimiter = require('./rate_limiter');

const ActionExecutor = new lang.Class({
    Name: 'ActionExecutor',

    _init: function(engine, app, output) {
        this.engine = engine;
        this.app = app;
        this.output = output;

        if (this.output.action) {
            this.selector = new ChannelOpener(engine, this.app, 'w',
                                              this.output.action.selector,
                                              this.output.action.name);
        } else {
            this.selector = null;
        }
    },

    _getOutputKeyword: function() {
        var compiler = this.app.compiler;

        var scope, name, feedId;
        var decl = compiler.getKeywordDecl(this.output.keyword.name);
        if (decl.extern)
            scope = null;
        else
            scope = this.app.uniqueId;
        if (decl.feedAccess)
            feedId = this.app.feedId;
        else
            feedId = null;
        name = this.output.keyword.name;

        // if this is a feed accessible keyword, owner must be self
        return this.engine.keywords.getOpenedKeyword(scope, name, feedId, decl.feedAccess);
    },

    start: function() {
        if (this.selector) {
            return this.selector.start();
        } else {
            return this._getOutputKeyword().then(function(kw) {
                this._outputKeyword = kw;
            }.bind(this));
        }
    },

    stop: function() {
        if (this.selector) {
            return this.selector.stop();
        } else {
            return this._outputKeyword.close();
        }
    },

    execute: function(env) {
        var value = this.output.produce(env);

        if (this.selector) {
            this.selector.values().forEach(function(channel) {
                channel.sendEvent(value);
            });
        } else {
            // ignore owner because we punched through to LocalKeyword
            this._outputKeyword.changeValue(value);
        }
    }
});

const QueryExecutor = new lang.Class({
    Name: 'QueryExecutor',
    Extends: events.EventEmitter,

    _init: function(engine, app, query) {
        this.engine = engine;
        this.app = app;

        this._keywords = [];
        this._keywordAsts = {};
        this._query = query;
        this._selector = new ChannelOpener(this.engine, this.app, 'q',
                                           query.invocation.selector,
                                           query.invocation.name);
    },

    invoke: function(env, cont) {
        var args = this._query.invocation.params.map(function(f) {
            return f(env);
        });

        this._selector.values().forEach(function(ch) {
            Q.try(function() {
                return Q(ch.invokeQuery(args)).then(function(rows) {
                    rows.forEach(function(row) {
                        var clone = env.clone();
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
    },

    stop: function() {
        return this._selector.stop();
    },

    start: function() {
        return this._selector.start().catch(function(e) {
            console.error('Error while setting up query: ' + e.message);
            console.error(e.stack);
            this.app.reportError(e);
        }.bind(this));
    },
});

module.exports = new lang.Class({
    Name: 'RuleExecutor',

    _init: function(engine, app, rule) {
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
    },

    _runQueries: function(env, cont) {
        function loop(queries, env, i, cont) {
            if (i === queries.length)
                return cont(env);

            return queries[i].invoke(env, function(env) {
                return loop(queries, env, i+1, cont);
            });
        }

        return loop(this.queries, env, 0, cont);
    },

    _onTriggered: function(env) {
        // check if this trigger was rate limited, and do nothing if so
        // don't even log - as logging could clog the server alone
        if (!this._rateLimiter.hit())
            return;

        this._runQueries(env, function(env) {
            this.outputs.forEach(function(out) {
                out.execute(env);
            });
        }.bind(this));
    },

    start: function() {
        return Q.try(function() {
            return Q.all(this.everything.map(function(out) {
                return out.start();
            }));
        }.bind(this)).then(function() {
            this.input.start().done();
        }.bind(this));
    },

    stop: function() {
        return this.input.stop().then(function() {
            return Q.all(this.everything.map(function(out) {
                return out.stop();
            }));
        }.bind(this));
    },
});

