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

import AsyncQueue from 'consumer-queue';
import { Ast, SchemaRetriever } from 'thingtalk';
import assert from 'assert';

import { DialogueTurn } from '../dataset-tools/parsers';
import { ReplacedResult } from '../utils/template-string';
import { Hashable } from '../utils/hashmap';

import {
    ContextPhrase,
    Template,
    AgentReply,
    AgentReplyRecord,
    SemanticAction,
    TemplatePlaceholderMap
} from '../sentence-generator/types';
import SentenceGenerator from '../sentence-generator/generator';
import { NonTerminal } from '../sentence-generator/runtime';

import SimulationDialogueAgent from './simulator/simulation-thingtalk-executor';
import {
    DialogueInterface,
    Synthesizer,
} from './interface';
import { Command } from './command';
import {
    AbstractCommandIO,
    SimpleCommandDispatcher,
    TerminatedDialogueError,
    UnexpectedCommandError
} from './cmd-dispatch';
import { PolicyFunction, PolicyModule, PolicyStartMode } from './policy';
import { addTemplate } from './template-utils';

export interface AgentTurn {
    dialogue : SynthesisDialogue;
    utterance : ReplacedResult;
    meaning : Ast.DialogueState;
    state : Ast.DialogueState;
    tag : number;
}

export interface ExtendedAgentReplyRecord extends AgentReplyRecord {
    dialogue : SynthesisDialogue;
    tag : number;
}

export interface UserReplyRecord {
    dialogue : SynthesisDialogue;
    meaning : Ast.DialogueState;
}

export interface Continuation {
    turn : DialogueTurn;
    cmd : Command;
}

const enum PartialDialogueState {
    INIT, // dialogue not started
    RUNNING, // the policy function is doing something
    AGENT_SPEAKING, // the agent started speaking
    WAITING_USER, // waiting for user input
    DONE, // dialogue complete
}

/**
 * A serial counter of {@link PartialDialogue} objects, used for hashing.
 */
let partialDialogueID = 0;

/**
 * A partial dialogue, during synthesis.
 *
 * This class bridges the synthesis code, which operates over batches of dialogues
 * (arrays of {@link DialogueTurn}) and the policy functions.
 *
 * The synthesis code calls {@link continue} and pushes user commands with
 * {@link pushCommand}.
 *
 * The policy functions, during a call to {@link continue}, call {@link get} to
 * retrieve the command, and call {@link emit} to terminate the agent turn.
 *
 * Note that this logic is quite similar to that implemented by {@link DialogueLoop}
 * at runtime, except we don't need a queue.
 */
export default class SynthesisDialogue implements AbstractCommandIO, Synthesizer, Hashable<SynthesisDialogue> {
    readonly turns : DialogueTurn[] = [];
    private readonly _id : number;
    private readonly _policy : PolicyModule;
    private readonly _fn : PolicyFunction;
    private readonly _dlg : DialogueInterface;
    private readonly _agentGenerator : SentenceGenerator;
    private readonly _userGenerator : SentenceGenerator;
    private readonly _commandQueue : AsyncQueue<Command>;

    private _state = PartialDialogueState.INIT;

    private _continuePromise : Promise<void>|null = null;
    private _continueResolve : (() => void)|null = null;

    constructor(options : {
        agentGenerator : SentenceGenerator,
        userGenerator : SentenceGenerator,
        simulator : SimulationDialogueAgent,
        policy : PolicyModule,
        locale : string,
        timezone : string|undefined,
        schemaRetriever : SchemaRetriever,
        flags : Record<string, boolean>,
        rng : () => number
    }) {
        this._id = partialDialogueID++;
        assert(this._id < 65536);

        this._agentGenerator = options.agentGenerator;
        this._userGenerator = options.userGenerator;
        this._policy = options.policy;
        this._fn = options.policy.policy;
        this._dlg = new DialogueInterface(null, {
            io: this,
            executor: options.simulator,
            dispatcher: new SimpleCommandDispatcher(this),
            synthesizer: this,
            simulated: true,
            interactive: false,
            deterministic: false,
            anonymous: false,
            ...options
        });
        this._commandQueue = new AsyncQueue();
    }

    get state() {
        return this._dlg.state;
    }

    hash() {
        return this._id;
    }
    equals(other : SynthesisDialogue) {
        return this === other;
    }

    private _getMainAgentContextPhrase() : ContextPhrase {
        return {
            symbol: this._agentGenerator.contextTable.ctx_dynamic_any,
            utterance: ReplacedResult.EMPTY,
            value: this._dlg.state,
            context: this,
            key: {
                dialogue: this
            }
        };
    }

    *getAgentContextPhrases() : IterableIterator<ContextPhrase> {
        const phrases = this._policy.getContextPhrasesForState(this._dlg.state, this._agentGenerator.tpLoader,
            this._agentGenerator.contextTable);
        if (phrases !== null) {
            yield this._getMainAgentContextPhrase();

            for (const phrase of phrases) {
                // override the context because we need the context in _generateAgent
                phrase.context = this;
                yield phrase;
            }
        }
    }

    private _getMainUserContextPhrase(agentTurn : AgentTurn) : ContextPhrase {
        return {
            symbol: this._userGenerator.contextTable.ctx_sys_dynamic_any,
            utterance: ReplacedResult.EMPTY,
            value: agentTurn,
            context: this,
            key: {
                dialogue: this,
                tag: this._id << 65536 | agentTurn.tag
            }
        };
    }

    *getUserContextPhrases(agentTurn : AgentTurn) : IterableIterator<ContextPhrase> {
        const phrases = this._policy.getContextPhrasesForState(agentTurn.state, this._userGenerator.tpLoader,
            this._userGenerator.contextTable!);
        if (phrases !== null) {
            yield this._getMainUserContextPhrase(agentTurn);

            for (const phrase of phrases) {
                // override the context because we need the context in _generateAgent
                phrase.context = agentTurn;
                yield phrase;
            }
        }
    }

    /**
     * Retrieve the next user command.
     *
     * This call will signal to the minibatch dialogue generator that the agent
     * code is done, and synthesis should proceed. It will block until synthesis
     * is done and a command has been chosen for this dialogue.
     *
     * @returns the next command for this dialogue
     */
    get() : Promise<Command> {
        if (this._state !== PartialDialogueState.AGENT_SPEAKING)
            throw new Error(`Invalid state for get`);
        this._state = PartialDialogueState.WAITING_USER;

        assert(this._continuePromise !== null);
        this._continueResolve!();
        this._continuePromise = null;

        return this._commandQueue.pop();
    }

    /**
     * Record a possible agent reply.
     *
     * @param reply the reply from the agent
     */
    async emit(reply : AgentReply, tag : number) : Promise<void> {
        if (this._state !== PartialDialogueState.RUNNING && this._state !== PartialDialogueState.AGENT_SPEAKING)
            throw new Error(`Invalid state for emit`);
        this._state = PartialDialogueState.AGENT_SPEAKING;

        if (reply.length > 1)
            throw new Error('not implemented yet');

        assert(reply[0].type === 'text');
        const { text: tmpl, args: placeholders, meaning: semantics } = reply[0];
        addTemplate(this._agentGenerator, [], tmpl, placeholders, (...args : any[]) : ExtendedAgentReplyRecord|null => {
            const result = semantics(...args);
            if (result === null)
                return null;
            if (result === undefined)
                throw new TypeError(`Missing semantics from agent reply`);

            return {
                dialogue: this,
                tag: tag,
                ...result
            };
        });
    }

    private _addDynamicUserTemplate(tag : number | null,
                                    tmpl : string,
                                    placeholders : TemplatePlaceholderMap,
                                    semantics : SemanticAction<[Ast.DialogueState, ...any[]], Ast.DialogueState>) {
        let ctxNonTerm;
        if (tag === null) {
            ctxNonTerm = new NonTerminal('ctx_sys_dynamic_any', undefined, ['dialogue', this]);
        } else {
            assert(tag < 65536);
            ctxNonTerm = new NonTerminal('ctx_sys_dynamic_any', undefined, ['tag', this._id << 65536 | tag]);
        }

        addTemplate(this._userGenerator, [ctxNonTerm], tmpl, placeholders, (ctx : AgentTurn, ...args : any[]) : UserReplyRecord|null => {
            const result = semantics(ctx.state, ...args);
            if (result === null)
                return null;
            return {
                dialogue: this,
                meaning: result,
            };
        });
    }

    /**
     * Record possible templates for synthesis at this state.
     *
     * @param templates templates that are available for synthesis at this state
     */
    synthesize(templates : Iterable<[number|null, Template<[Ast.DialogueState, ...any[]], Ast.DialogueState>]>) {
        for (const [tag, [tmpl, placeholders, semantics]] of templates)
            this._addDynamicUserTemplate(tag, tmpl, placeholders, semantics);
    }

    /**
     * Keep running this partial dialogue until it is blocked on the next user command.
     */
    run() : Promise<void> {
        if (this._state !== PartialDialogueState.RUNNING && this._state !== PartialDialogueState.INIT)
            throw new Error(`Invalid state for run`);

        // kick-start the policy function if we haven't started yet
        // this will continue going until it calls DialogueInterface.get(),
        // which in turn will call PartialDialogue.get (resolving _continuePromise)
        if (this._state === PartialDialogueState.INIT) {
            assert(this._continuePromise === null);
            this._continuePromise = new Promise<void>((resolve, reject) => {
                this._continueResolve = resolve;
            });

            this._state = PartialDialogueState.RUNNING;
            this._fn(this._dlg, PolicyStartMode.NORMAL).catch((e) => {
                if (!(e instanceof TerminatedDialogueError) && !(e instanceof UnexpectedCommandError))
                    throw e;
            }).then(() => {
                this._state = PartialDialogueState.DONE;
                if (this._continueResolve)
                    this._continueResolve();
                this._continuePromise = null;
            });
        } else {
            assert(this._continuePromise !== null, `must call continue before calling run after the first turn`);
        }

        return this._continuePromise.catch((e) => {
            if (e instanceof TerminatedDialogueError || e instanceof UnexpectedCommandError)
                return;
            throw e;
        });
    }

    /**
     * Continue this partial dialogue.
     *
     * @param continuation the turn with which to continue the dialogue
     */
    continue(continuation : Continuation) {
        if (this._state !== PartialDialogueState.WAITING_USER)
            throw new Error(`Invalid state for continue`);

        this.turns.push(continuation.turn);
        this._state = PartialDialogueState.RUNNING;

        assert(this._continuePromise === null);
        this._continuePromise = new Promise<void>((resolve, reject) => {
            this._continueResolve = resolve;
        });
        this._commandQueue.push(continuation.cmd);
    }
}
