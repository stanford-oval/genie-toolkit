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
const RefCounted = require('../util/ref_counted');
const ExecWrapper = require('./exec_wrapper');

module.exports = class RuleExecutor {
    constructor(engine, app, functions, tt, output) {
        this.engine = engine;
        this.app = app;

        this._env = new ExecWrapper(engine, app, functions, output);
        this._tt = tt;
        this._finished = null;
    }

    start() {
        this._finished = Q(this._tt(this._env));
    }
    waitFinished() {
        return this._finished;
    }

    stop() {
        this._env.stopTrigger();
        return this.waitFinished();
    }

    release() {
        console.log('Closing rule in ' + this.app.uniqueId);
        this._env.releaseAll();
    }
}

