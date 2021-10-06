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

import { Ast, Type } from 'thingtalk';

import { split } from '../utils/misc-utils';
import { Command, CommandType } from './command';
import { uniform } from '../utils/random';
import { AgentReply, AgentReplyRecord } from '../sentence-generator/types';
import ThingpediaLoader from '../templates/load-thingpedia';

function escapeStringRegexp(string : string) {
    // Copied from escape-string-regexp npm package
    //
    // Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)
    //
    // Permission is hereby granted, free of charge, to any person obtaining a copy of
    // this software and associated documentation files (the "Software"), to deal in the
    // Software without restriction, including without limitation the rights to use,
    // copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
    // Software, and to permit persons to whom the Software is furnished to do so,
    // subject to the following conditions:
    //
    // The above copyright notice and this permission notice shall be included in all
    // copies or substantial portions of the Software.
    //
    // THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
    // INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
    // PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
    // HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
    // CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE
    // OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

    // Escape characters with special meaning either inside or outside character sets.
    // Use a simple backslash escape when it’s always valid, and a `\xnn` escape when the simpler form would be disallowed by Unicode patterns’ stricter grammar.
    return string
            .replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
            .replace(/-/g, '\\x2d');
}

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
    expecting ?: Type|null;
    rawHandler ?: (cmd : string, tpLoader : ThingpediaLoader) => Ast.DialogueState|null;
    acceptActs ?: string[];
    acceptActions ?: string[];
    acceptQueries ?: string[];
    acceptStreams ?: boolean;
}

/**
 * Abstract interface to interact with the user.
 *
 * {@link InferenceTimeDialogue} implements this interface at runtime, and the
 * {@link SynthesisDialogue} implements this interface at synthesis time.
 *
 * This is an internal interface to Genie. It should not be used by outside code.
 */
export interface AbstractCommandIO {
    /**
     * The thingpedia loader object currently in use to generate agent utterances.
     *
     * This property can be accessed only when a valid state has been initialized
     * previously, and might throw an exception otherwise.
     */
    readonly tpLoader : ThingpediaLoader;

    /**
     * Fetch the next command from the user.
     */
    get(expecting : Type|null, raw : boolean) : Promise<Command>;

    /**
     * Emit the next reply from the agent.
     *
     * At synthesis time, this can be called multiple times with different `tag`s
     * to produce multiple potential replies. At inference time, this must be paired
     * with a single call to {@link get} exactly.
     *
     * The method returns `false` if a message cannot be sent to the user, because
     * either:
     * - the reply is empty or lacks a text component
     * - expanding the templates in the reply fails
     * - the semantic function for the reply returns null
     *
     * @param reply - the reply from the agent
     * @param tag - a tag to use at synthesis time to identify this specific reply
     * @returns whether a message was actually sent to the user or not
     */
    emit(reply : AgentReply, tag : number) : Promise<AgentReplyRecord|null>;
}

export class DummyCommandIO implements AbstractCommandIO {
    get tpLoader() : never {
        throw new Error(`No thingpedia loader available`);
    }

    async get() : Promise<never> {
        throw new Error(`No command available`);
    }

    async emit() : Promise<AgentReplyRecord|null> {
        // discard
        return null;
    }
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
    if (options.rawHandler && !cmd.utterance.startsWith('\\t '))
        return Compatibility.RAW;

    if (cmd.type === CommandType.THINGTALK_ACTION) {
        if (!options.acceptActions)
            return Compatibility.NONE;

        const action = cmd.meaning.history[0].stmt.expression.schema!.qualifiedName;
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

        const query = cmd.meaning.history[0].stmt.expression.schema!.qualifiedName;
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
        this._inGet = false;
    }

    async get(options : GetCommandOptions) {
        if (this._inGet)
            throw new Error(`Concurrent calls to DialogueInterface.get are not allowed. Use DialogueInterface.par or DialogueInterface.any instead`);
        this._inGet = true;
        try {
            const cmd = await this._io.get(options.expecting ?? null, !!options.rawHandler);

            const compat = isCommandCompatible(cmd, options);
            if (compat === Compatibility.RAW) {
                const handled = options.rawHandler!(cmd.utterance, this._io.tpLoader);
                if (handled === null)
                    throw new UnexpectedCommandError(cmd);
                return new Command(cmd.utterance, cmd.context, handled);
            }

            if (compat === Compatibility.NONE)
                throw new UnexpectedCommandError(cmd);

            return cmd;
        } finally {
            this._inGet = false;
        }
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

        let expecting : Type|null = null, raw = false;
        for (const waiter of this._waiters) {
            if (waiter.getCmdOptions!.expecting !== null) {
                if (expecting === null)
                    expecting = waiter.getCmdOptions!.expecting ?? Type.Any;
                else if (waiter.getCmdOptions!.expecting !== Type.Any && waiter.getCmdOptions!.expecting !== expecting)
                    expecting = Type.Any;
            }
            raw = raw || !!waiter.getCmdOptions!.rawHandler;
        }
        this._io.get(expecting, raw).then((cmd) => {
            const compat = this._waiters.map((state) => isCommandCompatible(cmd, state.getCmdOptions!));

            // first check for some waiting dialogue in raw mode
            const raw = this._waiters.filter((w, i) => compat[i] === Compatibility.RAW);
            for (const choice of raw) {
                const handled = choice.getCmdOptions!.rawHandler!(cmd.utterance, this._io.tpLoader);
                if (handled !== null) {
                    const cmd2 = new Command(cmd.utterance, cmd.context, handled);
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
