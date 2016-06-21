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
const ExecWrapper = require('./exec_wrapper');

module.exports = class CommandExecutor {
    constructor(engine, app, command) {
        this.engine = engine;

        this.app = app;
        this._state = app.state;

        this._env = new ExecWrapper(this.engine, app, command.keywords);
        this.outputs = command.outputs.map(function(out) {
            return new ActionExecutor(engine, app, out);
        });
    }

    run() {
        return this._env.start().then(() => {
            return Q.all(this.outputs.map((out) => out.start()));
        }).then(() => {
            this.outputs.forEach(function(out) {
                out.execute(this._env);
            }, this);
        }).then(() => {
            return Q.all(this.outputs.map((out) => out.stop()));
        }).then(() => {
            return this._env.stop();
        });
    }
}
