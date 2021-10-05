
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
    Template,
    TemplatePlaceholderMap,
    AgentReply,
    AgentReplyRecord
} from '../sentence-generator/types';
import { Command, } from './command';
import {
    UnexpectedCommandError,
    TerminatedDialogueError,
    CommandDispatcher,
    ParallelCommandDispatcher,
    AbstractCommandIO
} from './cmd-dispatch';
import { PolicyFunction, PolicyModule, PolicyStartMode } from './policy';
import AbstractThingTalkExecutor, {
    ExecutionResult,
    NotificationConfig
} from './abstract-thingtalk-executor';
import { shouldAutoConfirmStatement, StateM } from '../utils/thingtalk';
import { NonTerminal } from '../sentence-generator/runtime';

/**
 * A callback that computes all the relevant templates to use for synthesis
 * at the given state
 */
export type SynthesisFunction<ReturnType> = (dlg : DialogueInterface) => Iterable<Template<[Ast.DialogueState, ...any[]], ReturnType>>;

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
 * Options that can be passed to {@link DialogueInterface.get}
 */
export interface GetOptions {
    /**
     * Templates to apply only at this state.
     */
    followUp ?: Iterable<Template<[Ast.DialogueState, ...any[]], Ast.DialogueState>>;

    /**
     * A ThingTalk type of a single value that the agent expect.
     *
     * This is used to configure the UI (keyboard, file/image pickers) for a specific type of input,
     * and it has no other effect otherwise; use `null` to explicitly indicate that the agent
     * is _not_ expecting an answer at all, and therefore the UI should reflect that and the
     * microphone should stop listening.
     */
    expecting ?: Type|null;

    /**
     * If specified, handles the raw command, without any parsing.
     */
    rawHandler ?: (cmd : string) => Ast.DialogueState|null;

    /**
     * The list of acceptable dialogue acts.
     */
    acceptActs ?: string[];

    /**
     * Fully qualified names of acceptable Thingpedia actions.
     */
    acceptActions ?: string[];

    /**
     * Fully qualified names of acceptable Thingpedia queries.
     */
    acceptQueries ?: string[],
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
     * `true` if this dialogue is for an anonymous user, `false` if it
     * is for a logged-in user.
     */
    readonly anonymous : boolean;

    /**
     * The random number generator to use for non-deterministic choices.
     */
    readonly rng : () => number;

    /**
     * Custom boolean flags to influence the policy behavior.
     */
    readonly flags : Record<string, boolean>;

    private readonly _policy : PolicyModule;
    private readonly _parent : DialogueInterface|null;
    private readonly _langPack : I18n.LanguagePack;
    private readonly _timezone : string|undefined;
    private readonly _schemas : SchemaRetriever;
    private readonly _deterministic : boolean;
    private readonly _io : AbstractCommandIO;
    private readonly _dispatcher : CommandDispatcher;
    private readonly _synthesizer : Synthesizer|undefined;
    private readonly _executor : AbstractThingTalkExecutor;

    /**
     * The current ThingTalk state of the dialogue (or null at the beginning of the dialogue).
     */
    state : Ast.DialogueState|null;

    /**
     * The last command issued by the user (or null at the beginning of the dialogue).
     */
    command : Command|null;

    private _lastResult : ExecutionResult[];
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
                    policy : PolicyModule,
                    io : AbstractCommandIO,
                    executor : AbstractThingTalkExecutor,
                    dispatcher : CommandDispatcher,
                    synthesizer ?: Synthesizer,
                    locale : string,
                    timezone : string|undefined,
                    schemaRetriever : SchemaRetriever,
                    simulated : boolean,
                    interactive : boolean,
                    deterministic : boolean,
                    anonymous : boolean,
                    flags : Record<string, boolean>,
                    rng : () => number
                }) {
        this.locale = options.locale;
        this.simulated = options.simulated;
        this.interactive = options.interactive;
        this.anonymous = options.anonymous;
        this.flags = options.flags;
        this.rng = options.rng;
        this.state = null;
        this.command = null;
        this._parent = parent;
        this._policy = options.policy;
        this._schemas = options.schemaRetriever;
        this._langPack = I18n.get(options.locale);
        this._ = this._langPack._;
        this._timezone = options.timezone;
        this._deterministic = options.deterministic;
        this._io = options.io;
        this._executor = options.executor;
        this._synthesizer = options.synthesizer;

        this._dispatcher = options.dispatcher;
        this._lastResult = [];
        this._userTemplates = new Map;
        this._sayBuffer = [];
        this._inGet = false;
        this._eitherTag = 0;
    }

    /**
     * The result of executing the last ThingTalk program
     */
    get lastResult() : ExecutionResult[] {
        if (this._parent)
            return this._parent.lastResult;
        else
            return this._lastResult;
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
     * @param options - additional options controlling what kind of commands are expected
     */
    async get(options : GetOptions = {}) : Promise<Command> {
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

        if (options.acceptActs) {
            for (let i = 0; i < options.acceptActs.length; i++) {
                if (!options.acceptActs[i].includes('.'))
                    options.acceptActs[i] = this._policy.MANIFEST.name + '.' + options.acceptActs[i];
            }
        }

        this.command = await this._dispatcher.get(options);
        this._inGet = false;
        return this.command;
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
     * Add a text message to the current turn of the agent.
     *
     * This method can be called multiple times in a single turn, and the
     * messages are all concatenated.
     *
     * If a dialogue state is specified, it will be used as the formal meaning of
     * the current agent turn. If a semantic action is specified, the
     * output of that semantic action will be used as the formal meaning of the turn.
     * The semantic action receives as input the specified values of the placeholders
     */
    say<T>(tmpl : NonTerminal<T>, semantics ?: SemanticAction<[T], Ast.DialogueState|AgentReplyRecord>) : void;
    say(tmpl : string, args ?: TemplatePlaceholderMap) : void;
    say(tmpl : string, semantics : Ast.DialogueState) : void;
    say(tmpl : string, args : TemplatePlaceholderMap, semantics : SemanticAction<any[], Ast.DialogueState|AgentReplyRecord>) : void;
    say(arg1 : string|NonTerminal<any>, arg2 ?: TemplatePlaceholderMap|Ast.DialogueState|SemanticAction<any[], Ast.DialogueState|AgentReplyRecord>, arg3 ?: SemanticAction<any[], Ast.DialogueState|AgentReplyRecord>) {
        let tmpl : string;
        let args : TemplatePlaceholderMap;
        let semantics : SemanticAction<any[], Ast.DialogueState|AgentReplyRecord>|undefined;
        if (arg1 instanceof NonTerminal) {
            const name = arg1.name ?? arg1.symbol;
            tmpl = '${' + name + '}';
            args = { [name]: arg1 };
            if (typeof arg2 === 'function')
                semantics = arg2;
        } else {
            tmpl = arg1;
            let state : Ast.DialogueState|undefined;
            if (arg2 instanceof Ast.DialogueState) {
                state = arg2;
                args = {};
            } else if (arg2) {
                state = undefined;
                assert(typeof arg2 === 'object');
                args = arg2;
            } else {
                state = undefined;
                args = {};
            }

            if (state) {
                // assign to a local variable to remove "|undefined" from the type
                const s2 = state;
                semantics = () => s2;
            }
        }

        this._sayBuffer.push({
            type: 'text',
            text: tmpl,
            args,
            meaning: semantics !== undefined ? wrapAgentReplySemantics(semantics) : (() => undefined)
        });
    }

    /**
     * Add a link message to the current turn of the agent.
     *
     * This method can be called multiple times in a single turn, and the
     * messages are all concatenated.
     *
     * Note that link messages do not carry a meaning. You must call {@link say}
     * in the same turn to include a message with a meaning.
     */
    sendLink(title : string, url : string, args : TemplatePlaceholderMap = {}) {
        // at synthesis time we don't need interactive messages
        if (this._synthesizer)
            return;

        this._sayBuffer.push({
            type: 'link',
            args, title, url,
        });
    }

    /**
     * Add a button message to the current turn of the agent.
     *
     * This method can be called multiple times in a single turn, and the
     * messages are all concatenated.
     *
     * Note that button messages do not carry a meaning. You must call {@link say}
     * in the same turn to include a message with a meaning.
     */
    sendButton(title : string, json : string, args : TemplatePlaceholderMap = {}) {
        // at synthesis time we don't need interactive messages
        if (this._synthesizer)
            return;

        this._sayBuffer.push({
            type: 'button',
            args, title, json,
        });
    }

    /**
     * Add a button message for a multiple choice button to the current turn of the agent.
     *
     * This is a convenience wrapper over {@link sendButton}.
     */
    sendChoice(idx : number, choice : string) {
        // at synthesis time we don't need interactive messages
        if (this._synthesizer)
            return;

        const state = StateM.makeSimpleState(this.state, this._policy.MANIFEST.name, 'answer_choice', [new Ast.Value.Number(idx)]);
        this._sayBuffer.push({
            type: 'button',
            args: {},
            title: choice,
            json: JSON.stringify({
                program: state.prettyprint()
            }),
        });
    }

    private _lookingFor(expecting : Type, dialogueState : Ast.DialogueState) {
        if (expecting === Type.Boolean)
            this.say(this._("Please answer yes or no."), dialogueState);
        else if (expecting instanceof Type.Measure)
            this.say(this._("Could you give me a measurement?"), dialogueState);
        else if (expecting === Type.Number)
            this.say(this._("Could you give me a number?"), dialogueState);
        else if (expecting === Type.Date)
            this.say(this._("Could you give me a date?"), dialogueState);
        else if (expecting === Type.Time)
            this.say(this._("Could you give me a time of day?"), dialogueState);
        else if (expecting instanceof Type.Entity && expecting.type === 'tt:picture')
            this.say(this._("Could you upload a picture?"), dialogueState);
        else if (expecting === Type.Location)
            this.say(this._("Could you give me a place?"), dialogueState);
        else if (expecting instanceof Type.Entity && expecting.type === 'tt:phone_number')
            this.say(this._("Could you give me a phone number?"), dialogueState);
        else if (expecting instanceof Type.Entity && expecting.type === 'tt:email_address')
            this.say(this._("Could you give me an email address?"), dialogueState);
    }

    private _fail(msg ?: string) {
        if (msg)
            this.say(this._("Sorry, I did not understand that: ${error}."), { error: msg });
        else
            this.say(this._("Sorry, I did not understand that."));
    }

    /**
     * Ask a question with a well defined answer.
     *
     * This is a convenience function over {@link say}+{@link get} that will continuously
     * prompt the user until they give an answer of the right type.
     *
     * @deprecated This function should not be used. Instead, use helpers in {@link TransactionPolicy}.
     */
    async ask(tmpl : string, args : TemplatePlaceholderMap, agentDialogueAct : string, agentDialogueActParam : Array<string|Ast.Value>, expectedType : Type, getOptions : GetOptions = {}) {
        const dialogueState = StateM.makeSimpleState(this.state, this._policy.MANIFEST.name, agentDialogueAct, agentDialogueActParam);

        this.say(tmpl, args, () => dialogueState);

        for (;;) {
            try {
                const cmd = await this.get({
                    expecting: expectedType,
                    acceptActs: ['answer'],
                    followUp: [
                        ['${v}', {
                            v: ''
                        }, (state : Ast.DialogueState, v : Ast.Value) => StateM.makeSimpleState(state, this._policy.MANIFEST.name, 'answer', [v])]
                    ],
                    ...getOptions
                });
                const value = cmd.meaning.dialogueActParam?.[0];
                if (!(value instanceof Ast.Value) || !value.getType().equals(expectedType))
                    throw new UnexpectedCommandError(cmd);

                return value;
            } catch(e) {
                if (!(e instanceof UnexpectedCommandError))
                    throw e;
                this._fail();
                this._lookingFor(expectedType, dialogueState);

                // continue the loop to try again
            }
        }
    }

    async askChoices(tmpl : string, args : TemplatePlaceholderMap, agentDialogueAct : string, choices : string[], getOptions : GetOptions = {}) {
        const dialogueState = StateM.makeSimpleState(this.state, this._policy.MANIFEST.name, agentDialogueAct, choices.map((c) => new Ast.Value.String(c)));

        this.say(tmpl, args, () => dialogueState);
        for (let idx = 0; idx < choices.length; idx++)
            this.sendChoice(idx, choices[idx]);

        for (;;) {
            try {
                const cmd = await this.get({
                    expecting: undefined,
                    acceptActs: ['answer_choice'],
                    // TODO followUp
                    ...getOptions
                });
                const value = cmd.meaning.dialogueActParam?.[0];
                if (!(value instanceof Ast.NumberValue))
                    throw new UnexpectedCommandError(cmd);
                const choice = value.value;
                if (choice < 0 || choice >= choices.length)
                    throw new UnexpectedCommandError(cmd);

                return choice;
            } catch(e) {
                if (!(e instanceof UnexpectedCommandError))
                    throw e;
                this._fail();
                this.say(this._("Can you choose one of the following?"), dialogueState);
                for (let idx = 0; idx < choices.length; idx++)
                    this.sendChoice(idx, choices[idx]);

                // continue the loop to try again
            }
        }
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
     * Prepare a dialogue state for being executed.
     *
     * This will split the statements that are immediately executable for those that
     * require further input from the user. It will also resolve all ThingTalk values that
     * are relative to the user, such as `$context.location.current_location`, and will assign
     * device IDs to all Thingpedia function calls.
     *
     * Statements in the state are modified in place.
     *
     * @param state - the dialogue state to prepare
     */
    private async _prepareForExecution(state : Ast.DialogueState) {
        const hints = this._executor.collectDisambiguationHintsForState(this.state);

        const toExecute : Ast.ExpressionStatement[] = [];
        const remaining : Ast.DialogueHistoryItem[] = [];

        for (const item of state.history) {
            assert(item.confirm !== 'proposed');
            if (item.results !== null)
                continue;

            await this._executor.prepareStatementForExecution(this, item.stmt, hints);

            if (item.confirm === 'accepted' &&
                item.isExecutable() &&
                shouldAutoConfirmStatement(item.stmt))
                item.confirm = 'confirmed';

            // if we can execute this statement and all previous statements, we push
            // this statement to the program to execute
            // otherwise we push to the list of remaining todo items
            if (item.confirm === 'confirmed' && item.isExecutable() && remaining.length === 0)
                toExecute.push(item.stmt);
            else
                remaining.push(item);
        }

        // if we have a stream, we'll trigger notifications
        // configure them if necessary
        let notificationConfig : NotificationConfig|undefined = undefined;
        if (toExecute.some((stmt) => stmt instanceof Ast.ExpressionStatement && stmt.stream))
            notificationConfig = await this._executor.configureNotifications(this);

        const program = new Ast.Program(null, [], [], toExecute);
        return [program, remaining, notificationConfig] as const;
    }

    /**
     * Execute (or simulate) the ThingTalk statements contained in the given dialogue state.
     *
     * @returns the result of executing each statement
     */
    async execute(statements : Ast.DialogueState) : Promise<ExecutionResult[]> {
        // prepare for execution now, even if we don't execute yet
        // so we slot-fill eagerly

        const [program, remaining, notificationConfig] = await this._prepareForExecution(statements);
        const executionResults = await this._doExecute(program, notificationConfig);
        this._lastResult = executionResults;

        // update the state with everything that we just executed
        const newState = new Ast.DialogueState(null, statements.policy, statements.dialogueAct, statements.dialogueActParam, []);
        if (this.state !== null) {
            for (const item of this.state.history) {
                if (item.results !== null)
                    newState.history.push(item);
            }
        }
        for (const result of executionResults)
            newState.history.push(new Ast.DialogueHistoryItem(null, result.stmt, result.results, 'confirmed'));

        // append everything that we did not execute
        for (const item of remaining) {
            newState.history.push(item);
            executionResults.push({
                stmt: item.stmt,
                results: null,
                rawResults: []
            });
        }

        this.state = newState;
        return executionResults;
    }

    private async _doExecute(program : Ast.Program, notificationConfig : NotificationConfig|undefined) : Promise<ExecutionResult[]> {
        if (program.statements.length === 0)
            return [];
        if (this._parent)
            return this._parent._doExecute(program, notificationConfig);

        return this._executor.execute(this, program, notificationConfig);
    }

    private clone(withDispatcher : CommandDispatcher) : DialogueInterface {
        const clone = new DialogueInterface(this, {
            policy: this._policy,
            io: this._io,
            executor: this._executor,
            dispatcher: withDispatcher,
            synthesizer: this._synthesizer,
            locale: this._langPack.locale,
            timezone: this._timezone,
            schemaRetriever: this._schemas,
            simulated: this.simulated,
            interactive: this.interactive,
            deterministic: this._deterministic,
            anonymous: this.anonymous,
            flags: this.flags,
            rng: this.rng
        });
        clone.state = this.state;
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
            await first.value(this, PolicyStartMode.NORMAL);
            await this.flush();
        } else {
            const state = this.state;
            const initialEitherTag = this._eitherTag;
            for (const action of actions) {
                this.state = state;
                this._eitherTag ++;
                await action(this, PolicyStartMode.NORMAL);
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
        await fn(nested, PolicyStartMode.NORMAL);
        this.state = nested.state;
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
            await fn(nested, PolicyStartMode.NORMAL);
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
                await fn(nested, PolicyStartMode.NORMAL);
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

        const parsed = Syntax.parse(code, Syntax.SyntaxType.Normal, {
            locale: this._langPack.locale,
            timezone: this._timezone,
        });
        await parsed.typecheck(this._schemas, true);
        return parsed;
    }
}
