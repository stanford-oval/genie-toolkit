// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const ActionExecutor = require('./action_executor');
const QueryExecutor = require('./query_executor');
const ExecWrapper = require('./exec_wrapper');

module.exports = class CommandExecutor {
    constructor(engine, app, command) {
        this.engine = engine;

        this.app = app;
        this._state = app.state;

        this._env = new ExecWrapper(this.engine, app, command.keywords);
        this.queries = command.queries.map(function(query) {
            return new QueryExecutor(engine, app, query);
        });
        this.outputs = command.outputs.map(function(out) {
            return new ActionExecutor(engine, app, out);
        });

        this.everything = this.queries.concat(this.outputs);
    }

    _runQueries(env, cont, onerr) {
        function loop(queries, env, i, cont) {
            if (i === queries.length)
                return cont(env);

            return queries[i].invoke(env, function(env) {
                return loop(queries, env, i+1, cont);
            }, onerr);
        }

        return loop(this.queries, env, 0, cont);
    }

    run() {
        return this._env.start().then(() => {
            return Q.all(this.everything.map((out) => out.start()));
        }).then(() => {
            return Q.Promise((callback, errback) => {
                this._runQueries(this._env, (env) => {
                    this.outputs.forEach((out) => {
                        out.execute(env);
                    });

                    callback();
                }, errback);
            });
        }).then(() => {
            return Q.all(this.everything.map((out) => out.stop()));
        }).then(() => {
            return this._env.stop();
        });
    }
}
