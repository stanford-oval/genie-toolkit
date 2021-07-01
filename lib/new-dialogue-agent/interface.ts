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
import { Ast, SchemaRetriever, Syntax } from 'thingtalk';

import * as I18n from '../i18n';

import { DerivationKey, SemanticAction } from '../sentence-generator/types';
import { PlaceholderReplacement, Replaceable, ReplacedResult } from '../utils/template-string';
import { Command, CommandType } from './command';
export { Command, CommandType };
import { UnexpectedCommandError, TerminatedDialogueError, CommandDispatcher, ParallelCommandDispatcher, AbstractCommandIO } from './cmd-dispatch';
export { UnexpectedCommandError, TerminatedDialogueError };

/**
 * This module contains the public API of the Genie dialogue scripting language.
 */

/**
 * A single template for synthesis.
 *
 * This consists of a phrase with placeholders, a semantic function to compute the
 * formal representation, and an optional key to optimize matching templates
 * according to the rules of the semantic function.
 */
export type Template<ArgTypes extends unknown[], ReturnType> =
    [Replaceable, SemanticAction<ArgTypes, ReturnType>] |
    [Replaceable, DerivationKey, SemanticAction<ArgTypes, ReturnType>];

/**
 * A callback that computes all the relevant templates to use for synthesis
 * at the given state
 */
export type SynthesisFunction<ReturnType> = (dlg : DialogueInterface) => Iterable<Template<any[], ReturnType>>;

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
     * The current ThingTalk state of the dialogue (or null at the beginning of the dialogue).
     */
    state : Ast.DialogueState|null;

    /**
     * The random number generator to use for non-deterministic choices.
     */
    readonly rng : () => number;

    private readonly _schemas : SchemaRetriever;
    private readonly _deterministic : boolean;
    private readonly _io : AbstractCommandIO;

    private _dispatcher : CommandDispatcher;
    private _synthesisFunctions : Array<SynthesisFunction<Ast.DialogueState>>;
    private _sayBuffer : ReplacedResult[];
    private _nextAgentState : Ast.DialogueState|null;

    constructor(options : {
        io : AbstractCommandIO,
        dispatcher : CommandDispatcher,
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
        this.state = null;
        this._schemas = options.schemaRetriever;
        this._ = I18n.get(options.locale)._;
        this._deterministic = options.deterministic;
        this._io = options.io;

        this._dispatcher = options.dispatcher;
        this._synthesisFunctions = [];
        this._sayBuffer = [];
        this._nextAgentState = null;
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
     * @param options.followUp - a synthesis function to apply only at this state
     * @param options.acceptActs - the list of acceptable dialogue acts
     * @param options.acceptActions - fully qualified names of acceptable Thingpedia actions
     * @param options.acceptQueries - fully qualified names of acceptable Thingpedia queries
     */
    async get(options : {
        followUp ?: SynthesisFunction<Ast.DialogueState>,
        acceptActs ?: string[],
        acceptActions ?: string[],
        acceptQueries ?: string[],
    } = {}) : Promise<Command> {
        // TODO send the current agent utterance to the output/synthesis
        console.log(this._nextAgentState);

        return this._dispatcher.get(options);
    }

    /**
     * Register a synthesis function to use at any state.
     *
     * This method can be called at the beginning of the dialogue function to
     * register all relevant synthesis functions.
     *
     * The method has no effect outside of synthesis and it is safe to call
     * unconditionally.
     */
    use(fn : SynthesisFunction<Ast.DialogueState>) {
        this._synthesisFunctions.push(fn);
    }

    /**
     * Add a message to the current turn of the agent.
     *
     * This method can be called multiple times in a single turn, and the
     * messages are all concatenated.
     *
     * If a semantic action is specified, the output of
     * that semantic action will be passed to {@link DialogueInterface.addState}.
     */
    say(tmpl : Replaceable, args : PlaceholderReplacement[], semantics ?: SemanticAction<any[], Ast.DialogueState>) {
        const replaced = tmpl.replace({
            constraints: {},
            replacements: args
        });
        if (replaced === null)
            return;

        if (semantics) {
            const value = semantics(...args);
            if (value === null)
                return;
            this.addState(value);
        }
        this._sayBuffer.push(replaced);
    }

    /**
     * Set the new agent state for the current turn.
     *
     * This method csn be called multiple times in one turn, and each time the new
     * agent state is merged with the existing state.
     */
    addState(newAgentState : Ast.DialogueState) {
        this._nextAgentState = newAgentState;
    }

    /**
     * Execute (or simulate) a ThingTalk program.
     *
     * The newly executed program is immediately appended to the current
     * dialogue state.
     */
    execute(program : Ast.Program) : Promise<ExecutionResult> {
        throw new Error(`not implemented`);
    }

    private clone(withDispatcher : CommandDispatcher) : DialogueInterface {
        return new DialogueInterface({
            io: this._io,
            dispatcher: withDispatcher,
            locale: this.locale,
            schemaRetriever: this._schemas,
            simulated: this.simulated,
            interactive: this.interactive,
            deterministic: this._deterministic,
            rng: this.rng
        });
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
