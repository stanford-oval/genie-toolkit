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
const AsyncQueue = require('consumer-queue');

const ThingTalk = require('thingtalk');
const AppGrammar = ThingTalk.Grammar;
const AppCompiler = ThingTalk.Compiler;
const RuleExecutor = require('./rule_executor');
const { ChannelState } = require('../db/channel');

class QueueOutputDelegate {
    constructor() {
        this._queue = new AsyncQueue();
    }

    [Symbol.asyncIterator]() {
        return this;
    }
    next() {
        return this._queue.pop();
    }

    done() {
        this._queue.push({ done: true });
    }
    output(outputType, outputValue) {
        this._queue.push({ done: false, value: { outputType, outputValue } });
    }
    notifyError(error) {
        this._queue.push({ done: false, value: error });
    }
}

class NotificationOutputDelegate {
    constructor(app) {
        this._app = app;
        this._engine = app.engine;
    }

    done() {}

    /**
     * Report that the app had an error.
     * @param {Error} error - the error that occurred.
     * @package
     */
    notifyError(error) {
        this._app.error = error;
        return this._engine.assistant.notifyErrorAll(this._app.uniqueId, this._app.icon, error);
    }

    /**
     * Report a new result from app.
     * @param {string} outputType - the type of result.
     * @param {any} outputValue - the actual result.
     * @package
     */
    output(outputType, outputValue) {
        return this._engine.assistant.notifyAll(this._app.uniqueId, this._app.icon, outputType, outputValue);
    }
}

/**
 * The representation of a currently executing ThingTalk program.
 *
 * A ThingTalk program can consist of multiple commands and rules.
 * Each is mapped to a separate {@ link ExecWrapper}, but they are grouped
 * under this object.
 */
class AppExecutor extends events.EventEmitter {
    /**
     * Construct a new app executor.
     *
     * @param {Engine} engine - the engine that owns this app executor
     * @param {string} code - the full ThingTalk program to execute
     * @param {Object} meta - app meta information
     * @param {string} [meta.icon] - the app icon
     * @param {string} [meta.conversation] - the ID of the conversation associated with this app
     * @param {string} name - the app name
     * @param {string} description - the app description
     * @package
     */
    constructor(engine, code, meta, name, description) {
        super();

        /**
         * The engine that owns this app.
         * @type {Engine}
         * @readonly
         */
        this.engine = engine;

        /**
         * The ThingTalk code of this app.
         * @type {string}
         * @readonly
         */
        this.code = code;

        /**
         * Whether this app is running.
         *
         * This is set automatically by the engine.
         * @type {boolean}
         */
        this.isRunning = false;

        /**
         * Whether this app is enabled (should be run automatically at startup).
         * @type {boolean}
         */
        this.isEnabled = false;

        /**
         * The ThingTalk compiler used by this app.
         * @type {ThingTalk.Compiler}
         * @readonly
         * @private
         */
        this.compiler = new AppCompiler(engine.schemas);
        this.command = null;
        this.rules = [];

        try {
            this._ast = AppGrammar.parse(code);
            this._error = null;
        } catch(e) {
            this._error = e;
        }

        this._meta = meta;
        /**
         * The icon to use for this app.
         * @type {string|null}
         * @readonly
         */
        this.icon = meta.icon || meta.$icon || null;

        this._updateNameDescription(name, description);

        this._finished = false;

        this._states = [];

        this.mainOutput = new QueueOutputDelegate();
        this._notificationOutput = new NotificationOutputDelegate(this);
    }

    get metadata() {
        return this._meta;
    }

    _updateNameDescription(name, description) {
        if (name)
            this.name = name;
        if (description)
            this.description = description;
        else if (this._meta.description)
            this.description = this._meta.description;
        else
            this.description = this.engine._("This app has no description");
    }

    /**
     * The last error reported by this app.
     * @type {string}
     */
    get error() {
        if (this._error)
            return this._error.message || this._error;
        else
            return null;
    }
    set error(e) {
        this._error = e;
    }
    reportError(error) {
        this._notificationOutput.notifyError(error);
    }

    /**
     * Complete abrupt termination of this app.
     *
     * This method should be called in case the user stopped the app,
     * after all commands have been stopped.
     *
     * @package
     * @async
     */
    destroy() {
        if (this._finished)
            return Promise.resolve();

        // FINISHME send AbortProgram to the source (if any)
        return Promise.resolve();
    }

    /**
     * Stop and delete this app.
     * @async
     */
    removeSelf() {
        this.engine.apps.removeApp(this);
    }

    /**
     * Attempt compilation of this app.
     *
     * This method must be called before running the app through {@link AppExecutor#runCommand}
     * or {@link AppExecutor#start}.
     *
     * On failure, this method will set {@link AppExecutor#error}.
     * @async
     */
    async compile() {
        if (this._error)
            throw this._error;

        const compiled = await this.compiler.compileProgram(this._ast);

        if (compiled.command)
            this.command = new RuleExecutor(this.engine, this, compiled.command, this.mainOutput);

        this._finishedRules = new Set;
        for (let rule of compiled.rules) {
            const executor = new RuleExecutor(this.engine, this, rule, this._notificationOutput);
            this.rules.push(executor);
            executor.on('finish', () => {
                this._finishedRules.add(executor);
                if (this._finishedRules.size === this.rules.length) {
                    console.log(`All rules in ${this.uniqueId} finished, removing self`);
                    this._finished = true;
                    this.removeSelf();
                }
            });
        }
    }

    /**
     * Execute all immediate commands in this app.
     *
     * This method will execute the portion of the app that uses the `now =>` stream.
     * It should be called only for a newly created app, not for an app that was loaded from
     * disk after a restart.
     *
     * This method must not be called on an app returned by {@link Engine#createApp} or
     * {@link AppDatabase#createApp}, as those methods will already call this one.
     *
     * @async
     */
    async runCommand() {
        if (this.command) {
            this.command.start();
            await this.command.waitFinished();
        }
    }

    /**
     * Await natural termination of this app.
     *
     * This method returns a promise that is fulfilled when the app terminates normally,
     * either because it has no streams and all immediate commands terminated, or because
     * all streams terminated.
     * @async
     */
    waitFinished() {
        const promises = this.command ? [this.command.waitFinished()] : [];
        promises.push(...this.rules.map((r) => r.waitFinished()));
        return Promise.all(promises);
    }

    _getState(stateId) {
        if (!this._states[stateId])
            this._states[stateId] = new ChannelState(this.engine.platform, 'app:' + this.uniqueId + ':' + stateId);
        return this._states[stateId];
    }

    readState(stateId) {
        return this._getState(stateId).read();
    }
    writeState(stateId, state) {
        return this._getState(stateId).write(state);
    }

    /**
     * Start execution of this app in background.
     * @async
     * @package
     */
    start() {
        return Promise.all(this.rules.map((r) => r.start()));
    }

    /**
     * Pause execution of this app.
     *
     * This method pauses the app temporarily, and is called when the engine is terminating.
     * The app will be restarted the next time the engine is restarted. To stop the app
     * permanently, use {@link AppDatabase#removeApp} or {@link AppExecutor#removeSelf}.
     * @async
     * @package
     */
    stop() {
        return Promise.all(this.rules.map((r) => r.stop()));
    }
}
module.exports = AppExecutor;
