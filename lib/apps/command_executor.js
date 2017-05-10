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
const RefCounted = require('../util/ref_counted');

module.exports = class CommandExecutor extends RefCounted {
    constructor(engine, app, command) {
        super();
        this.engine = engine;
        this.isCommand = true;

        this.app = app;
        this._state = app.state;

        this._env = new ExecWrapper(this.engine, app, command.keywords);
        this.queries = command.queries.map((query) => {
            return new QueryExecutor(engine, app, this, query);
        });
        this.outputs = command.outputs.map((out) => {
            return new ActionExecutor(engine, app, this, out);
        });

        this.everything = this.queries.concat(this.outputs);

        this._refCount = 0;
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

    _doOpen() {
        return this._env.start().then(() => {
            return Q.all(this.everything.map((out) => out.start()));
        });
    }

    _doRun() {
        return this._runQueries(this._env, (env) => {
            this.outputs.forEach((out) => {
                out.execute(env);
            });
        });
    }

    _doClose() {
        return Q.all(this.everything.map((out) => out.stop())).then(() => {
            return this._env.stop();
        });
    }

    run() {
        return this.open().then(() => {
            return this._doRun();
        }).then(() => {
            return this.close();
        })
    }
}
