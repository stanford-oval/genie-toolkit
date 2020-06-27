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
    constructor(engine, app, compiled) {
        super();
        this.engine = engine;
        this.app = app;

        this._env = new ExecWrapper(engine, app);
        this._tt = compiled;

        // create an early promise so we can call waitFinished() before start()
        this._finished = null;
        this._finishPromise = new Promise((resolve, reject) => {
            this._finished = { resolve, reject };
        });
    }

    setOutput(output) {
        this._env.output = output;
    }

    async _ruleThread() {
        try {
            await this._tt(this._env);
        } catch(e) {
            this._env.reportError('Uncaught error in rule', e);
        }

        this.emit('finish');
        this._finished.resolve();
    }

    start() {
        this._ruleThread();
    }
    waitFinished() {
        return this._finishPromise;
    }

    end() {
        this._env.endProgram();
        return this.waitFinished();
    }

    stop() {
        this._env.stopTrigger();
    }
};
