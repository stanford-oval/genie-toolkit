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

const ExecWrapper = require('./exec_wrapper');

module.exports = class RuleExecutor extends events.EventEmitter {
    constructor(engine, app, compiled, output) {
        super();
        this.engine = engine;
        this.app = app;

        let [functions, sqlStatements, tt] = compiled;
        this._env = new ExecWrapper(engine, app, functions, sqlStatements, output);
        this._tt = tt;
        this._finished = null;
    }

    start() {
        this._finished = Q(this._tt(this._env)).then(() => {
            this.emit('finish');
        });
    }
    waitFinished() {
        return this._finished;
    }

    end() {
        this._env.endProgram();
        return this.waitFinished();
    }

    stop() {
        this._env.stopTrigger();
    }

    release() {
        this._env.releaseAll();
    }
}

