// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
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

        this._env = new ExecWrapper(this.engine, app, app.mainOutput);
        this.queries = command.queries.map((query) => {
            return new QueryExecutor(engine, app, this, query);
        });
        this.actions = command.actions.map((out) => {
            return new ActionExecutor(engine, app, this, out);
        });

        this.everything = this.queries.concat(this.actions);

        this._refCount = 0;
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

    _doOpen() {
        return Q.all(this.everything.map((out) => out.start()));
    }

    _doRun() {
        return this._runQueries(this._env, (env) => this._runActions(env));
    }

    _doClose() {
        return this.everything.map((out) => out.stop());
    }

    run() {
        return this.open().then(() => {
            return this._doRun();
        }).then(() => {
            return this.close();
        })
    }
}
