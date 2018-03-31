// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const events = require('events');

const ExecWrapper = require('./exec_wrapper');

module.exports = class RuleExecutor extends events.EventEmitter {
    constructor(engine, app, compiled, output) {
        super();
        this.engine = engine;
        this.app = app;

        this._env = new ExecWrapper(engine, app, compiled, output);
        this._tt = compiled.code;
        this._finished = null;
    }

    start() {
        this._finished = Promise.resolve().then(() => this._tt(this._env)).then(() => {
            this.emit('finish');
        }).catch((e) => {
            this._env.reportError('Uncaught error in rule', e);
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
};

