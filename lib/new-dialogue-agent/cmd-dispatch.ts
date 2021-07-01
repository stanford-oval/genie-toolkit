// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2021 The Board of Trustees of the Leland Stanford Junior University
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

import escapeStringRegexp from 'escape-string-regexp';
import { Ast, Type } from 'thingtalk';

import { split } from '../utils/misc-utils';
import { Command, CommandType } from './command';
import { uniform } from '../utils/random';

export class UnexpectedCommandError extends Error {
    code = 'ERR_UNEXPECTED_COMMAND' as const;

    constructor(public readonly command : Command) {
        super(`Unexpected command`);
    }
}

export class TerminatedDialogueError extends Error {
    code = 'ERR_TERMINATED_DIALOGUE' as const;

    constructor() {
        super(`The dialogue was terminated`);
    }
}

interface GetCommandOptions {
    rawHandler ?: (cmd : string) => Ast.DialogueState|null;
    acceptActs ?: string[];
    acceptActions ?: string[];
    acceptQueries ?: string[];
    acceptStreams ?: boolean;
}

export interface AgentReplyRecord {
    state : Ast.DialogueState;
    expect : Type|null;
    numResults : number;
}

/**
 * Abstract interface to interact with the user.
 *
 * The ThingTalkDialogueHandler implements this interface at runtime, and the
 * SynthesisCommandQueue implements this interface at synthesis time.
 *
 * Calls to this method must be paired correctly: it is an error to have two
 * consecutive calls to {@link next} or two consecutive calls to {@link reply}.
 */
export interface AbstractCommandIO {
    /**
     * Fetch the next command from the user.
     */
    get() : Promise<Command>;

    /**
     * Emit the next reply from the agent.
     */
    emit(reply : AgentReplyRecord) : void;
}

const enum Compatibility {
    /**
     * No compatibility
     */
    NONE,
    /**
     * Compatible because the dialogue handler specifies a wildcard
     */
    POSSIBLE,
    /**
     * Compatible because the dialogue handler specifies the dialogue act/function exactly.
     */
    PERFECT,
    /**
     * Compatible because there is a raw handler
     */
    RAW
}

function patternToRegExp(pattern : string) {
    let regexp = '';
    for (const chunk of split(pattern, /[*?]/g)) {
        if (typeof chunk === 'string')
            regexp += escapeStringRegexp(chunk);
        else
            regexp += chunk[0] === '*' ? '.*' : '.';
    }
    return new RegExp('^' + regexp + '$', 'g');
}

function wildCardMatch(pattern : string, str : string) {
    if (!/[*?]/.test(pattern))
        return false;
    // some simple fast paths to avoid building full regexps
    if (pattern === '*')
        return true;
    // ends with * and does not have * or ? anywhere else
    if (/^[^*?]+\*$/.test(pattern))
        return str.startsWith(pattern.substring(0, pattern.length-1));

    // general case
    return patternToRegExp(pattern).test(str);
}

function isCommandCompatible(cmd : Command, options : GetCommandOptions) : Compatibility {
    if (options.rawHandler)
        return Compatibility.RAW;

    if (cmd.type === CommandType.THINGTALK_ACTION) {
        if (!options.acceptActions)
            return Compatibility.NONE;

        const action = cmd.state.history[0].stmt.expression.schema!.qualifiedName;
        if (options.acceptActions.some((a) => a === action))
            return Compatibility.PERFECT;

        if (options.acceptActions.some((a) => wildCardMatch(a, action)))
            return Compatibility.POSSIBLE;

        return Compatibility.NONE;
    }

    if (cmd.type === CommandType.THINGTALK_QUERY ||
        cmd.type === CommandType.THINGTALK_STREAM) {
        if (cmd.type === CommandType.THINGTALK_STREAM &&
            options.acceptStreams === false)
            return Compatibility.NONE;
        if (!options.acceptQueries)
            return Compatibility.NONE;

        const query = cmd.state.history[0].stmt.expression.schema!.qualifiedName;
        if (options.acceptQueries.some((q) => q === query))
            return Compatibility.PERFECT;

        if (options.acceptQueries.some((q) => wildCardMatch(q, query)))
            return Compatibility.POSSIBLE;

        return Compatibility.NONE;
    }

    const act = cmd.type;
    if (!options.acceptActs)
        return Compatibility.NONE;
    if (options.acceptActs.some((a) => a === act))
        return Compatibility.PERFECT;

    if (options.acceptActs.some((a) => wildCardMatch(a, act)))
        return Compatibility.POSSIBLE;

    return Compatibility.NONE;
}

/**
 * Abstract interface that is capable of deciding if a command should be
 * handled or it should cause exception handling.
 */
export interface CommandDispatcher {
    get(options : GetCommandOptions) : Promise<Command>;
}

export class SimpleCommandDispatcher implements CommandDispatcher {
    private _io : AbstractCommandIO;
    private _inGet : boolean;

    constructor(io : AbstractCommandIO) {
        this._io = io;
        this._inGet = true;
    }

    async get(options : GetCommandOptions) {
        if (this._inGet)
            throw new Error(`Concurrent calls to DialogueInterface.get are not allowed. Use DialogueInterface.par or DialogueInterface.any instead`);
        this._inGet = true;
        const cmd = await this._io.get();
        this._inGet = false;

        const compat = isCommandCompatible(cmd, options);
        if (compat === Compatibility.RAW) {
            const handled = options.rawHandler!(cmd.utterance);
            if (handled === null)
                throw new UnexpectedCommandError(cmd);
            return new Command(cmd.utterance, handled);
        }

        if (compat === Compatibility.NONE)
            throw new UnexpectedCommandError(cmd);

        return cmd;
    }
}

interface WaiterState {
    getCmdOptions : GetCommandOptions|null;

    promise : Promise<Command>|null;
    resolve : ((cmd : Command) => void)|null;
    reject : ((err : Error) => void)|null;
}

export class ParallelCommandDispatcher {
    private _io : AbstractCommandIO;
    private _waiters : WaiterState[];
    private _terminated : boolean;
    private _deterministic : boolean;
    private _rng : () => number;

    constructor(io : AbstractCommandIO, n : number, options : {
        deterministic : boolean;
        rng : () => number;
    }) {
        this._io = io;
        this._terminated = false;
        this._deterministic = options.deterministic;
        this._rng = options.rng;

        this._waiters = [];
        for (let i = 0; i < n; i++) {
            this._waiters.push({
                getCmdOptions: null,
                promise: null,
                resolve: null,
                reject: null
            });
        }
    }

    getDispatcher(i : number) : CommandDispatcher {
        return {
            get: (options : GetCommandOptions) => {
                return this.get(i, options);
            }
        };
    }

    terminate() {
        this._terminated = true;

        const err = new TerminatedDialogueError();
        for (const state of this._waiters) {
            if (state.reject)
                state.reject(err);
            state.promise = null;
            state.resolve = null;
            state.reject = null;
        }
    }

    private get(i : number, options : GetCommandOptions) : Promise<Command> {
        const state = this._waiters[i];
        if (state.promise !== null)
            throw new Error(`Concurrent calls to DialogueInterface.get are not allowed. Use DialogueInterface.par or DialogueInterface.any instead`);

        if (this._terminated)
            return Promise.reject(new TerminatedDialogueError());

        state.getCmdOptions = options;
        state.promise = new Promise<Command>((resolve, reject) => {
            state.resolve = resolve;
            state.reject = reject;
        });
        this._maybeDispatchCommand();

        return state.promise;
    }

    private _maybeDispatchCommand() {
        if (this._waiters.some((state) => state.promise === null))
            return;

        this._io.get().then((cmd) => {
            const compat = this._waiters.map((state) => isCommandCompatible(cmd, state.getCmdOptions!));

            // first check for some waiting dialogue in raw mode
            const raw = this._waiters.filter((w, i) => compat[i] === Compatibility.RAW);
            for (const choice of raw) {
                const handled = choice.getCmdOptions!.rawHandler!(cmd.utterance);
                if (handled !== null) {
                    const cmd2 = new Command(cmd.utterance, handled);
                    choice.resolve!(cmd2);
                    choice.promise = null;
                    choice.resolve = null;
                    choice.reject = null;
                    return;
                }
            }

            // first check if some of the waiting dialogues can handle the command perfectly

            const perfect = this._waiters.filter((w, i) => compat[i] === Compatibility.PERFECT);
            if (perfect.length > 0) {
                let choice;
                if (this._deterministic)
                    choice = perfect[0];
                else
                    choice = uniform(perfect, this._rng);
                choice.resolve!(cmd);
                choice.promise = null;
                choice.resolve = null;
                choice.reject = null;
                return;
            }

            // if none can handle it perfectly, check if some dialogue can handle the command at all

            const possible = this._waiters.filter((w, i) => compat[i] === Compatibility.POSSIBLE);
            if (possible.length > 0) {
                let choice;
                if (this._deterministic)
                    choice = possible[0];
                else
                    choice = uniform(possible, this._rng);
                choice.resolve!(cmd);
                choice.promise = null;
                choice.resolve = null;
                choice.reject = null;
                return;
            }

            // if nobody can handle at all, we fail everything with an unexpected command error

            const unexpected = new UnexpectedCommandError(cmd);

            for (const state of this._waiters) {
                // note: we rely on resolve/reject executing the continuation at the next tick
                state.reject!(unexpected);
                state.promise = null;
                state.resolve = null;
                state.reject = null;
            }
        }, (err) => {
            for (const state of this._waiters) {
                if (state.reject)
                    state.reject(err);
                state.promise = null;
                state.resolve = null;
                state.reject = null;
            }
        });
    }
}
