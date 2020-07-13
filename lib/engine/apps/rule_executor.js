// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
"use strict";

const events = require('events');

const ExecWrapper = require('./exec_wrapper');

module.exports = class RuleExecutor extends events.EventEmitter {
    constructor(engine, app, compiled, output) {
        super();
        this.engine = engine;
        this.app = app;

        this._output = output;
        this._env = new ExecWrapper(engine, app, output);
        this._tt = compiled;

        // create an early promise so we can call waitFinished() before start()
        this._finished = null;
        this._finishPromise = new Promise((resolve, reject) => {
            this._finished = { resolve, reject };
        });
    }

    async _ruleThread() {
        try {
            await this._tt(this._env);
        } catch(e) {
            this._env.reportError('Uncaught error in rule', e);
        }

        this.emit('finish');
        this._output.done();
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
