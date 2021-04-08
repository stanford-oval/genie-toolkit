// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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

import assert from 'assert';
import * as events from 'events';
import AsyncQueue from 'consumer-queue';

import { Syntax, Compiler as AppCompiler, Ast } from 'thingtalk';
import RuleExecutor from './rule_executor';
import { ChannelState } from '../db/channel';

import type Engine from '../index';

interface ResultItem {
    outputType : string;
    outputValue : Record<string, unknown>;
}

class QueueOutputDelegate {
    private _queue : AsyncQueue<IteratorResult<ResultItem|Error>>;

    constructor() {
        this._queue = new AsyncQueue();
    }

    [Symbol.asyncIterator]() : AsyncIterator<ResultItem|Error> {
        return this;
    }
    next() : Promise<IteratorResult<ResultItem|Error>> {
        return this._queue.pop();
    }

    done() {
        this._queue.push({ done: true, value: undefined });
    }
    output(outputType : string, outputValue : Record<string, unknown>) {
        this._queue.push({ done: false, value: { outputType, outputValue } });
    }
    notifyError(error : Error) {
        this._queue.push({ done: false, value: error });
    }
}

class NotificationOutputDelegate {
    private _app : AppExecutor;
    private _engine : Engine;

    constructor(app : AppExecutor) {
        this._app = app;
        this._engine = app.engine;
    }

    done() {}

    /**
     * Report that the app had an error.
     * @param {Error} error - the error that occurred.
     * @package
     */
    notifyError(error : Error) {
        this._app.setError(error);
        return this._engine.assistant.notifyErrorAll(this._app.uniqueId!, this._app.icon, error);
    }

    /**
     * Report a new result from app.
     * @param {string} outputType - the type of result.
     * @param {any} outputValue - the actual result.
     * @package
     */
    output(outputType : string, outputValue : Record<string, unknown>) {
        return this._engine.assistant.notifyAll(this._app.uniqueId!, this._app.icon, outputType, outputValue);
    }
}

interface AppMeta {
    icon ?: string|null;
    conversation ?: string;
    description ?: string;
}

/**
 * The representation of a currently executing ThingTalk program.
 *
 * A ThingTalk program can consist of multiple commands and rules.
 * Each is mapped to a separate {@ link ExecWrapper}, but they are grouped
 * under this object.
 */
export default class AppExecutor extends events.EventEmitter {
    /**
     * The unique ID of this app.
     */
    uniqueId : string|undefined;
    /**
     * The engine that owns this app.
     */
    engine : Engine;
    /**
     * The ThingTalk program of this app.
     */
    program : Ast.Program;
    /**
     * The icon to use for this app.
     */
    icon : string|null;
    name : string;
    description : string;

    mainOutput : QueueOutputDelegate;
    private _notificationOutput : NotificationOutputDelegate;

    /**
     * Whether this app is running.
     *
     * This is set automatically by the engine.
     */
    isRunning : boolean;
    /**
     * Whether this app is enabled (should be run automatically at startup).
     */
    isEnabled : boolean;

    /**
     * The ThingTalk compiler used by this app.
     */
    private compiler : AppCompiler;
    private _error : Error|null;
    private _meta : AppMeta;

    private command : RuleExecutor|null;
    private rules : RuleExecutor[];
    private _states : ChannelState[];

    private _finished : boolean;
    private _finishedRules : Set<RuleExecutor>;

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
    constructor(engine : Engine,
                code : string,
                meta : AppMeta,
                name : string|undefined,
                description : string|undefined) {
        super();

        this.uniqueId = undefined;
        this.engine = engine;

        this.isRunning = false;
        this.isEnabled = false;

        this.compiler = new AppCompiler(engine.schemas);
        this.command = null;
        this.rules = [];

        const ast = Syntax.parse(code);
        assert(ast instanceof Ast.Program);
        this.program = ast;
        this._error = null;

        this._meta = meta;
        this.icon = meta.icon || null;

        this.name = '';
        this.description = '';
        this._updateNameDescription(name, description);

        this._finished = false;
        this._finishedRules = new Set;

        this._states = [];

        this.mainOutput = new QueueOutputDelegate();
        this._notificationOutput = new NotificationOutputDelegate(this);
    }

    get metadata() : AppMeta {
        return this._meta;
    }

    private _updateNameDescription(name : string|undefined, description : string|undefined) {
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
     */
    get error() : string|null {
        if (this._error)
            return this._error.message || String(this._error);
        else
            return null;
    }
    setError(e : Error|null) {
        this._error = e;
    }
    reportError(error : Error) {
        this._notificationOutput.notifyError(error);
    }

    get hasRule() {
        return this.rules.length > 0;
    }

    /**
     * Complete abrupt termination of this app.
     *
     * This method should be called in case the user stopped the app,
     * after all commands have been stopped.
     *
     * @package
     */
    destroy() {
        if (this._finished)
            return Promise.resolve();

        // FINISHME send AbortProgram to the source (if any)
        return Promise.resolve();
    }

    /**
     * Stop and delete this app.
     */
    async removeSelf() {
        await this.engine.apps.removeApp(this);
    }

    /**
     * Attempt compilation of this app.
     *
     * This method must be called before running the app through {@link AppExecutor#runCommand}
     * or {@link AppExecutor#start}.
     *
     * On failure, this method will set {@link AppExecutor#error}.
     */
    async compile() : Promise<void> {
        const compiled = await this.compiler.compileProgram(this.program);

        if (compiled.command)
            this.command = new RuleExecutor(this.engine, this, compiled.command, this.mainOutput);

        for (const rule of compiled.rules) {
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
     */
    async runCommand() {
        if (this.command) {
            this.command.start();
            await this.command.waitFinished();
        } else {
            // mark the main output as done or we'll hang when we iterate it
            this.mainOutput.done();
        }
    }

    /**
     * Await natural termination of this app.
     *
     * This method returns a promise that is fulfilled when the app terminates normally,
     * either because it has no streams and all immediate commands terminated, or because
     * all streams terminated.
     */
    async waitFinished() {
        const promises = this.command ? [this.command.waitFinished()] : [];
        promises.push(...this.rules.map((r) => r.waitFinished()));
        await Promise.all(promises);
    }

    private _getState(stateId : number) {
        if (!this._states[stateId])
            this._states[stateId] = new ChannelState(this.engine.platform, 'app:' + this.uniqueId + ':' + stateId);
        return this._states[stateId];
    }

    readState(stateId : number) {
        return this._getState(stateId).read();
    }
    writeState(stateId : number, state : unknown) {
        return this._getState(stateId).write(state);
    }

    /**
     * Start execution of this app in background.
     */
    async start() {
        await Promise.all(this.rules.map((r) => r.start()));
    }

    /**
     * Pause execution of this app.
     *
     * This method pauses the app temporarily, and is called when the engine is terminating.
     * The app will be restarted the next time the engine is restarted. To stop the app
     * permanently, use {@link AppDatabase#removeApp} or {@link AppExecutor#removeSelf}.
     */
    async stop() {
        await Promise.all(this.rules.map((r) => r.stop()));
    }
}
