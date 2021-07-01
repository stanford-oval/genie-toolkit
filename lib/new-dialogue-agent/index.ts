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

import assert from 'assert';
import { Ast, SchemaRetriever, Syntax, Type } from 'thingtalk';

import * as I18n from '../i18n';

import {
    SemanticAction,
    ContextTable,
    ContextPhrase,
    Template,
    TemplatePlaceholderMap,
    AgentReply,
    AgentReplyRecord
} from '../sentence-generator/types';
import { Replaceable, } from '../utils/template-string';
import { Command, CommandType } from './command';
export { Command, CommandType };
import { UnexpectedCommandError, TerminatedDialogueError, CommandDispatcher, ParallelCommandDispatcher, AbstractCommandIO } from './cmd-dispatch';
export { UnexpectedCommandError, TerminatedDialogueError };
import type SentenceGenerator from '../sentence-generator/generator';
import type { SentenceGeneratorOptions } from '../sentence-generator/generator';
import type ThingpediaLoader from '../templates/load-thingpedia';
import AbstractDialogueAgent from '../dialogue-agent/abstract_dialogue_agent';

/**
 * This module contains the public API of the Genie dialogue scripting language.
 */

/**
 * A callback that computes all the relevant templates to use for synthesis
 * at the given state
 */
export type SynthesisFunction<ReturnType> = (dlg : DialogueInterface) => Iterable<Template<[Ast.DialogueState, ...any[]], ReturnType>>;

/**
 * A callback that implements the logic of the agent.
 */
export type PolicyFunction = (dlg : DialogueInterface) => Promise<void>;

/**
 * The result of executing a ThingTalk program.
 */
export interface ExecutionResult {
    /**
     * Whether the program could be executed or not.
     *
     * The program might not be executed if some required parameter is missing, or
     * if some value needs entity linking or user context resolution (`$location.current_location`,
     * `$self.phone_number`, etc.)
     */
    executed : boolean;

    /**
     * The results of executing the ThingTalk program, if any.
     *
     * This is a container with the list of actual results, a boolean indicating that more
     * results could be fetched from the API, and whether any error occurred.
     */
    results : Ast.DialogueHistoryResultList|null;
}

export interface Synthesizer {
    synthesize(templates : Iterable<[number|null, Template<[Ast.DialogueState, ...any[]], Ast.DialogueState>]>) : void;
}

function wrapAgentReplySemantics<T extends unknown[]>(semantics : SemanticAction<T, AgentReplyRecord|Ast.DialogueState>) : SemanticAction<T, AgentReplyRecord> {
    return function(...args) {
        const result = semantics(...args);
        if (result === null)
            return null;
        if (result instanceof Ast.DialogueState)
            return { meaning: result, numResults: 0 };
        return result;
    };
}

/**
 * The interface used by dialogue functions to interact with the user.
 *
 * A parameter of this type is provided to the dialogue function.
 */
export class DialogueInterface {
    readonly locale : string;
    readonly _ : (x : string) => string;

    /**
     * `true` if this dialogue is occurring during a real interaction with
     * the user, and `false` during synthesis.
     *
     * If this flag is false, it is recommended to avoid any external IO
     * or expensive computation.
     */
    readonly interactive : boolean;
    /**
     * If `true`, externally visible side-effects should be simulated, and
     * if `false`, dialogue functions are allow to perform side-effects.
     *
     * - During synthesis, interactive will be `false` and simulated will be `true`
     * - During real execution, interactive will be `true` and simulated will be `false`
     * - During manual annotation, interactive will be `true` and simulated will be `true`
     *
     * It is recommended though to confine side-effects to the execution of
     * ThingTalk programs through {@link DialogueInterface.execute}, which
     * honors the simulated flag.
     */
    readonly simulated : boolean;

    /**
     * The random number generator to use for non-deterministic choices.
     */
    readonly rng : () => number;

    private readonly _parent : DialogueInterface|null;
    private readonly _langPack : I18n.LanguagePack;
    private readonly _schemas : SchemaRetriever;
    private readonly _deterministic : boolean;
    private readonly _io : AbstractCommandIO;
    private readonly _dispatcher : CommandDispatcher;
    private readonly _synthesizer : Synthesizer|undefined;
    private readonly _executor : AbstractDialogueAgent<any>;

    private _state : Ast.DialogueState|null;
    private _execState : any|undefined = undefined;
    private _inGet : boolean;

    /**
     * Functions to use for synthesis of the user turn.
     *
     * These templates are registered dynamically by calling {@link expect}
     * while the agent runs. If they are registered inside a call to {@link either},
     * they will be registered with a unique ID corresponding to that parallel
     * branch of {@link either}, and will only be applicable to agent states that
     * were generated in that either branch. Otherwise, they will be registered
     * with `null` as the key.
     */
    private readonly _userTemplates : Map<number|null, Array<Template<[Ast.DialogueState, ...any[]], Ast.DialogueState>>>;
    private _sayBuffer : AgentReply;
    private _eitherTag : number;

    constructor(parent : DialogueInterface|null,
                options : {
                    io : AbstractCommandIO,
                    executor : AbstractDialogueAgent<any>,
                    dispatcher : CommandDispatcher,
                    synthesizer ?: Synthesizer,
                    locale : string,
                    schemaRetriever : SchemaRetriever,
                    simulated : boolean,
                    interactive : boolean,
                    deterministic : boolean,
                    rng : () => number
                }) {
        this.locale = options.locale;
        this.simulated = options.simulated;
        this.interactive = options.interactive;
        this.rng = options.rng;
        this._state = null;
        this._parent = parent;
        this._schemas = options.schemaRetriever;
        this._langPack = I18n.get(options.locale);
        this._ = this._langPack._;
        this._deterministic = options.deterministic;
        this._io = options.io;
        this._executor = options.executor;
        this._synthesizer = options.synthesizer;

        this._dispatcher = options.dispatcher;
        this._userTemplates = new Map;
        this._sayBuffer = [];
        this._inGet = false;
        this._eitherTag = 0;
    }

    /**
     * The current ThingTalk state of the dialogue (or null at the beginning of the dialogue).
     */
    get state() : Ast.DialogueState|null {
        if (this._parent)
            return this._parent.state;
        else
            return this._state;
    }

    /**
     * Retrieve the next command from the user.
     *
     * The "accept" options define the set of commands that the agent is prepared
     * to handle at this state.
     *
     * If a command is accepted if:
     * - it is a dialogue act other than "org.thingpedia.dialogue.transaction.execute",
     *   and it is listed in "acceptActs"
     * - it is a ThingTalk program that invokes an action listed in "acceptActions"
     *   (potentially with other queries or monitors)
     * - it is a ThingTalk program whose last query is listed in "acceptQueries"
     *   (potentially with other queries or monitors)
     *
     * All other commands raise a {@link UnexpectedCommandError}.
     *
     * @param options - additional options controlling what kind of commands
     * @param options.followUp - templates to apply only at this state
     * @param options.expecting - a ThingTalk type of a single value that the agent expect; this
     *    used to configure the UI (keyboard, file/image pickers) for a specific type of input,
     *    and it has no other effect otherwise; use `null` to explicitly indicate that the agent
     *    is _not_ expecting an answer at all, and therefore the UI should reflect that and the
     *    microphone should stop listening
     * @param options.rawHandler - if specified, handles the raw command, without any parsing
     * @param options.acceptActs - the list of acceptable dialogue acts
     * @param options.acceptActions - fully qualified names of acceptable Thingpedia actions
     * @param options.acceptQueries - fully qualified names of acceptable Thingpedia queries
     */
    async get(options : {
        followUp ?: Iterable<Template<[Ast.DialogueState, ...any[]], Ast.DialogueState>>,

        expecting ?: Type|null,
        rawHandler ?: (cmd : string) => Ast.DialogueState|null,
        acceptActs ?: string[],
        acceptActions ?: string[],
        acceptQueries ?: string[],
    } = {}) : Promise<Command> {
        await this.flush();
        if (this._inGet)
            throw new Error(`Multiple reentrant or parallel calls to DialogueInterface.get are not allowed`);
        this._inGet = true;

        if (this._synthesizer) {
            const userTemplates = this._userTemplates;
            this._synthesizer.synthesize(function*() : Iterable<[number|null, Template<[Ast.DialogueState, ...any[]], Ast.DialogueState>]> {
                if (options.followUp) {
                    for (const tmpl of options.followUp)
                        yield [null, tmpl];
                }
                for (const [tag, templates] of userTemplates) {
                    for (const tmpl of templates)
                        yield [tag, tmpl];
                }
            }());
        }

        const cmd = await this._dispatcher.get(options);
        this._state = cmd.state;

        this._inGet = false;
        return cmd;
    }

    /**
     * Register a synthesis function recording what commands to expect at this
     * point of the dialogue.
     *
     * This method can be called at the beginning of the dialogue function to
     * register synthesis functions that are valid at any state, or it can be
     * called inside a call to {@link either} to register synthesis functions
     * that are valid in that state.
     *
     * The method has no effect outside of synthesis and it is safe to call
     * unconditionally.
     */
    expect(templates : Iterable<Template<[Ast.DialogueState, ...any[]], Ast.DialogueState>>) {
        if (!this._synthesizer)
            return;

        const tag = this._eitherTag === 0 ? null : this._eitherTag;
        const list = this._userTemplates.get(tag);
        if (list) {
            for (const tmpl of templates)
                list.push(tmpl);
        } else {
            this._userTemplates.set(tag, Array.from(templates));
        }
    }

    /**
     * Add a message to the current turn of the agent.
     *
     * This method can be called multiple times in a single turn, and the
     * messages are all concatenated.
     *
     * If a dialogue state is specified, it will be used as the formal meaning of
     * the current agent turn. If a semantic action is specified, the
     * output of that semantic action will be used as the formal meaning of the turn.
     * The semantic action receives as input the specified values of the placeholders
     */
    say(tmpl : string, args ?: TemplatePlaceholderMap) : void;
    say(tmpl : string, semantics : Ast.DialogueState) : void;
    say(tmpl : string, args : TemplatePlaceholderMap, semantics : SemanticAction<any[], Ast.DialogueState|AgentReplyRecord>) : void;
    say(tmpl : string, argsOrState ?: TemplatePlaceholderMap|Ast.DialogueState, semantics ?: SemanticAction<any[], Ast.DialogueState|AgentReplyRecord>) {
        let args : TemplatePlaceholderMap;
        let state : Ast.DialogueState|undefined;
        if (argsOrState instanceof Ast.DialogueState) {
            state = argsOrState;
            args = {};
        } else if (argsOrState) {
            state = undefined;
            args = argsOrState;
        } else {
            state = undefined;
            args = {};
        }

        if (state) {
            // assign to a local variable to remove "|undefined" from the type
            const s2 = state;
            semantics = () => s2;
        }

        const names = Object.keys(args);
        const parsed = Replaceable.get(tmpl, this._langPack, names);

        this._sayBuffer.push([parsed, args, semantics !== undefined ? wrapAgentReplySemantics(semantics) : (() => undefined)]);
    }

    /**
     * Flush all current output from the agent and show it to user.
     *
     * Under normal circumstances, calls to {@link say} are buffered, and the
     * buffer is flushed in the subsequent call to {@link get} or when the dialogue
     * ends.
     *
     * This method can be used to force send the message immediately. It is useful
     * in combination with timeouts.
     *
     * This method has no effect if {@link say} has not been called since the last
     * flush.
     */
    async flush() {
        if (this._sayBuffer.length > 0) {
            await this._io.emit(this._sayBuffer, this._eitherTag);
            this._sayBuffer = [];
        }
    }

    /**
     * Execute (or simulate) a ThingTalk program.
     *
     * The newly executed program is immediately appended to the current
     * dialogue state.
     */
    async execute(program : Ast.Program) : Promise<ExecutionResult> {
        // TODO use program
        if (this._parent) {
            return this._parent.execute(program);
        } else {
            try {
                const { newDialogueState, newExecutorState } = await this._executor.execute(this._state!, this._execState);
                this._state = newDialogueState;
                this._execState = newExecutorState;
            } catch(e) {
                console.error(`Failed to execute dialogue`);
                console.error(this._state!.prettyprint());
                throw e;
            }
        }

        throw new Error(`not implemented`);
    }

    private clone(withDispatcher : CommandDispatcher) : DialogueInterface {
        const clone = new DialogueInterface(this, {
            io: this._io,
            executor: this._executor,
            dispatcher: withDispatcher,
            synthesizer: this._synthesizer,
            locale: this.locale,
            schemaRetriever: this._schemas,
            simulated: this.simulated,
            interactive: this.interactive,
            deterministic: this._deterministic,
            rng: this.rng
        });
        clone._state = this._state;
        return clone;
    }

    /**
     * Take a non-deterministic action.
     *
     * This method takes an iterable of functions, representing possible continuations
     * of the dialogue. The functions are allowed to call {@link say}, {@link execute},
     * and {@link addState}, but must _not_ call (directly or indirectly) {@link get},
     * {@link flush}, or any of the nesting functions ({@link nest}, {@link par}, {@link any}).
     *
     * At synthesis time, all or a large sample of the actions are executed. Each action
     * is executed sequentially.
     * At inference time, the system non-deterministically chooses on action to execute.
     *
     * At the end of this call, the dialogue will be flushed, and the {@link state}
     * property is undefined. You must not call {@link say}, or perform any action that
     * depends on the state, before the next call to {@link get}.
     *
     * @param actions - possible actions to execute
     */
    async either(actions : Iterable<PolicyFunction>) {
        if (this._deterministic) {
            const first = actions[Symbol.iterator]().next();
            if (first.done)
                return;
            await first.value(this);
            await this.flush();
        } else {
            const state = this._state;
            const initialEitherTag = this._eitherTag;
            for (const action of actions) {
                this._state = state;
                this._eitherTag ++;
                await action(this);
                await this.flush();
            }
            this._eitherTag = initialEitherTag;
        }
    }

    /**
     * Nest a dialogue function.
     *
     * The nested dialogue function will be called with a fresh dialogue interface
     * and its own set of templates for synthesis (i.e. it will not be affected
     * by calls to {@link DialogueInterface.use})
     */
    async nest(fn : PolicyFunction) : Promise<void> {
        const nested = this.clone(this._dispatcher);
        await fn(nested);
        this._state = nested._state;
    }

    /**
     * Run multiple dialogues in parallel.
     *
     * All dialogue functions will be executed concurrently until they all block
     * in a call to {@link DialogueInterface.get}. At that point, one get call will
     * be resolved with the command from the user, chosen based on the "accept".
     *
     * The call to `all` resolves when all dialogues terminate, either normally or
     * with an exception. This is similar to the behavior of `Promise.allSettled`.
     */
    async par(...fns : PolicyFunction[]) : Promise<void> {
        const parallel = new ParallelCommandDispatcher(this._io, fns.length, {
            deterministic: this._deterministic,
            rng: this.rng
        });
        const results = await Promise.allSettled(fns.map(async (fn, i) => {
            const nested = this.clone(parallel.getDispatcher(i));
            await fn(nested);
        }));

        for (const result of results) {
            if (result.status === 'rejected' &&
                !(result.reason instanceof UnexpectedCommandError ||
                  result.reason instanceof TerminatedDialogueError))
                  throw result.reason;
        }
    }

    /**
     * Run multiple dialogues in parallel, exit when the first exists.
     *
     * This is equivalent to {@link DialogueInterface.par}, except that
     * after the first dialogue terminates, either successfully or with an exception,
     * all other calls to {@link DialogueInterface.get} in nested dialogues fail with
     * {@link TerminatedDialogueError}.
     *
     * As with {@link DialogueInterface.par}, this call resolves when all dialogues
     * terminate, either normally or with an exception. That is, if a dialogue handles
     * the {@link TerminatedDialogueError} and does not exit, this call will not resolve.
     */
    async any(...fns : PolicyFunction[]) : Promise<void> {
        const parallel = new ParallelCommandDispatcher(this._io, fns.length, {
            deterministic: this._deterministic,
            rng: this.rng
        });
        const results = await Promise.allSettled(fns.map(async (fn, i) => {
            const nested = this.clone(parallel.getDispatcher(i));
            try {
                await fn(nested);
            } finally {
                parallel.terminate();
            }
            // TODO terminate the command dispatcher here
        }));

        for (const result of results) {
            if (result.status === 'rejected' &&
                !(result.reason instanceof UnexpectedCommandError ||
                  result.reason instanceof TerminatedDialogueError))
                  throw result.reason;
        }
    }

    async _T(tmpls : TemplateStringsArray, ...exprs : Ast.Node[]) : Promise<Ast.Input> {
        assert(tmpls.length === exprs.length+1);

        let code = '';
        for (let i = 0; i < tmpls.raw.length-1; i++) {
            code += tmpls.raw[i];
            code += exprs[i].prettyprint();
        }
        code += tmpls.raw[tmpls.raw.length-1];

        const parsed = Syntax.parse(code);
        await parsed.typecheck(this._schemas, true);
        return parsed;
    }
}

/**
 * The abstract interface of a dialogue policy module.
 *
 * This interface defines the functions that a policy module should export.
 */
 export interface PolicyModule {
    /**
     * The policy manifest.
     *
     * This is used to check the generated dialogue states for correctness.
     */
    MANIFEST : {
        name : string,
        terminalAct : string,
        dialogueActs : {
            user : readonly string[],
            agent : readonly string[],
            withParam : readonly string[]
        },
    },

    initializeTemplates(agentOptions : SentenceGeneratorOptions, langPack : I18n.LanguagePack, grammar : SentenceGenerator, tpLoader : ThingpediaLoader) : Promise<void>;

    policy(dlg : DialogueInterface) : Promise<void>;
    getContextPhrasesForState(state : Ast.DialogueState|null, tpLoader : ThingpediaLoader, contextTable : ContextTable) : ContextPhrase[]|null;

    interpretAnswer?(state : Ast.DialogueState, value : Ast.Value, tpLoader : ThingpediaLoader, contextTable : ContextTable) : Ast.DialogueState|null;

    initialState?(tpLoader : ThingpediaLoader) : Ast.DialogueState|null;

    notification?(appName : string | null, program : Ast.Program, result : Ast.DialogueHistoryResultItem) : Ast.DialogueState|null;
    notifyError?(appName : string | null, program : Ast.Program, error : Ast.Value) : Ast.DialogueState|null;

    getFollowUp?(state : Ast.DialogueState, tpLoader : ThingpediaLoader, contextTable : ContextTable) : Ast.DialogueState|null;
}
