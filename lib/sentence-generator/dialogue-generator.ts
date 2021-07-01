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

import AsyncQueue from 'consumer-queue';
import * as Tp from 'thingpedia';
import { Ast, SchemaRetriever, Syntax } from 'thingtalk';
import assert from 'assert';
import stream from 'stream';
import * as path from 'path';

import * as I18n from '../i18n';
import { coin, ReservoirSampler, } from '../utils/random';
import * as ThingTalkUtils from '../utils/thingtalk';
import { SimulationDatabase } from '../dialogue-agent/simulator/types';
import * as TransactionPolicy from '../templates/transactions';

import SentenceGenerator, { SentenceGeneratorOptions } from './generator';
import {
    ContextPhrase,
    Template,
    AgentReply,
    AgentReplyRecord,
    SemanticAction,
    TemplatePlaceholderMap
} from './types';
import SimulationDialogueAgent from '../dialogue-agent/simulator/simulation_dialogue_agent';

import {
    AbstractCommandIO,
    SimpleCommandDispatcher,
    TerminatedDialogueError,
    UnexpectedCommandError
} from '../new-dialogue-agent/cmd-dispatch';
import {
    Command,
    DialogueInterface,
    PolicyModule,
    PolicyFunction,
    Synthesizer,
} from '../new-dialogue-agent';
import { Replaceable, ReplacedResult } from '../utils/template-string';
import { Hashable } from '../utils/hashmap';
import { NonTerminal } from './runtime';

interface DialogueTurn {
    context : string|null;
    agent : string|null;
    agent_target : string|null;
    user : string;
    user_target : string;
}
type Dialogue = DialogueTurn[];

interface AgentTurn {
    dialogue : PartialDialogue;
    utterance : ReplacedResult;
    meaning : Ast.DialogueState;
    state : Ast.DialogueState;
    tag : number;
}

interface ExtendedAgentReplyRecord extends AgentReplyRecord {
    dialogue : PartialDialogue;
    tag : number;
}

interface UserReplyRecord {
    dialogue : PartialDialogue;
    meaning : Ast.DialogueState;
}

interface Continuation {
    turn : DialogueTurn;
    cmd : Command;
}

const FACTORS = [50, 75, 75, 100];

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
class PartialDialogue implements AbstractCommandIO, Synthesizer, Hashable<PartialDialogue> {
    readonly turns : DialogueTurn[] = [];
    private readonly _id : number;
    private readonly _fn : PolicyFunction;
    private readonly _langPack : I18n.LanguagePack;
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
        policy : PolicyFunction,
        locale : string,
        schemaRetriever : SchemaRetriever,
        rng : () => number
    }) {
        this._id = partialDialogueID++;
        assert(this._id < 65536);

        this._agentGenerator = options.agentGenerator;
        this._userGenerator = options.userGenerator;
        this._fn = options.policy;
        this._langPack = I18n.get(options.locale);
        this._dlg = new DialogueInterface(null, {
            io: this,
            executor: options.simulator,
            dispatcher: new SimpleCommandDispatcher(this),
            synthesizer: this,
            simulated: true,
            interactive: false,
            deterministic: false,
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
    equals(other : PartialDialogue) {
        return this === other;
    }

    getMainAgentContextPhrase() : ContextPhrase {
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
    getMainUserContextPhrase(agentTurn : AgentTurn) : ContextPhrase {
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

    private _processPlaceholderMap(nonTerms : NonTerminal[], names : string[], placeholders : TemplatePlaceholderMap) {
        for (const alias in placeholders) {
            const symbol = placeholders[alias];
            if (symbol === null)
                return;
            names.push(alias);
            if (typeof symbol === 'string') {
                nonTerms.push(new NonTerminal(symbol, alias));
            } else if (!Array.isArray(symbol)) {
                // do something
                throw new Error('not implemented yet');
            } else if (symbol.length === 3) {
                nonTerms.push(new NonTerminal(symbol[0], alias, [symbol[1], symbol[2]]));
            } else {
                nonTerms.push(new NonTerminal(symbol[0], alias, [symbol[1], symbol[2], symbol[3]]));
            }
        }
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

        const [tmpl, placeholders, semantics] = reply[0];

        const nonTerms : NonTerminal[] = [];
        const names : string[] = [];
        this._processPlaceholderMap(nonTerms, names, placeholders);

        let repl;
        try {
            repl = Replaceable.get(tmpl, this._langPack, names);
        } catch(e) {
            throw new Error(`Failed to parse dynamic template string for ${tmpl} (${nonTerms.join(', ')}): ${e.message}`);
        }
        this._agentGenerator.addDynamicRule(nonTerms, repl, (...args : any[]) : ExtendedAgentReplyRecord|null => {
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
        const nonTerms : NonTerminal[] = [];
        const names : string[] = [];

        if (tag === null) {
            nonTerms.push(new NonTerminal('ctx_sys_dynamic_any', undefined, ['dialogue', this]));
            names.push('_1');
        } else {
            assert(tag < 65536);
            nonTerms.push(new NonTerminal('ctx_sys_dynamic_any', undefined, ['tag', this._id << 65536 | tag]));
            names.push('_1');
        }

        this._processPlaceholderMap(nonTerms, names, placeholders);
        let repl;
        try {
            repl = Replaceable.get(tmpl, this._langPack, names);
        } catch(e) {
            throw new Error(`Failed to parse dynamic template string for ${tmpl} (${nonTerms.join(', ')}): ${e.message}`);
        }

        this._userGenerator.addDynamicRule(nonTerms, repl, (ctx : AgentTurn, ...args : any[]) : UserReplyRecord|null => {
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
            this._fn(this._dlg).catch((e) => {
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

/**
 * Generate a minibatch of dialogues.
 *
 * This object is created afresh for every minibatch.
 */
class MinibatchDialogueGenerator {
    private _agentGenerator : SentenceGenerator;
    private _userGenerator : SentenceGenerator;
    private _langPack : I18n.LanguagePack;
    private _policy : PolicyModule;
    private _stateValidator : ThingTalkUtils.StateValidator;
    private _minibatchSize : number;
    private _rng : () => number;
    private _options : DialogueGeneratorOptions;
    private _logPrefix : string;

    private _minibatchIdx : number;
    private _turnIdx : number;

    private _debug : boolean;

    private _partialDialogues : PartialDialogue[];
    private _completeDialogues : Array<ReservoirSampler<Dialogue>>;

    constructor(agentGenerator : SentenceGenerator,
                userGenerator : SentenceGenerator,
                langPack : I18n.LanguagePack,
                policy : PolicyModule,
                simulator : SimulationDialogueAgent,
                stateValidator : ThingTalkUtils.StateValidator,
                options : DialogueGeneratorOptions,
                minibatchIdx : number) {
        this._agentGenerator = agentGenerator;
        this._userGenerator = userGenerator;
        this._langPack = langPack;
        this._policy = policy;
        this._stateValidator = stateValidator;
        this._minibatchSize = options.minibatchSize;
        this._rng = options.rng;
        this._options = options;
        this._logPrefix = options.logPrefix || '';

        this._minibatchIdx = minibatchIdx;
        this._turnIdx = 0;

        this._debug = true;

        this._partialDialogues = [];
        for (let i = 0; i < options.minibatchSize; i++) {
            this._partialDialogues.push(new PartialDialogue({
                agentGenerator: agentGenerator,
                userGenerator: userGenerator,
                policy: policy.policy,
                simulator: simulator,
                locale: options.locale,
                schemaRetriever: options.schemaRetriever,
                rng: options.rng
            }));
        }

        this._completeDialogues = [];
        for (let turnIdx = 0; turnIdx < options.maxTurns; turnIdx++) {
            const factor = turnIdx < FACTORS.length ? FACTORS[turnIdx] : FACTORS[FACTORS.length-1];
            this._completeDialogues[turnIdx] = new ReservoirSampler(Math.ceil(this._minibatchSize * factor), this._rng);
        }
    }

    private *_agentGetContextPhrases() {
        for (const dlg of this._partialDialogues) {
            const phrases = this._policy.getContextPhrasesForState(dlg.state, this._agentGenerator.tpLoader,
                this._agentGenerator.contextTable);
            if (phrases !== null) {
                yield dlg.getMainAgentContextPhrase();

                for (const phrase of phrases) {
                    // override the context because we need the context in _generateAgent
                    phrase.context = dlg;
                    yield phrase;
                }
            }
        }
    }

    private *_userGetContextPhrases(agentTurns : readonly AgentTurn[]) {
        for (const agentTurn of agentTurns) {
            const phrases = this._policy.getContextPhrasesForState(agentTurn.state, this._userGenerator.tpLoader,
                this._userGenerator.contextTable!);
            if (phrases !== null) {
                yield agentTurn.dialogue.getMainUserContextPhrase(agentTurn);

                for (const phrase of phrases) {
                    // override the context because we need the context in _generateAgent
                    phrase.context = agentTurn;
                    yield phrase;
                }
            }
        }
    }

    private _maybeAddCompleteDialog(turns : DialogueTurn[]) {
        assert(turns.length > 0);
        this._completeDialogues[turns.length-1].add(turns);
    }

    private _postprocessSentence(sentence : ReplacedResult,
                                 program : Ast.DialogueState,
                                 forTarget : 'user'|'agent') : string {
        let utterance = sentence.chooseSample(this._rng);
        utterance = utterance.replace(/ +/g, ' ');
        utterance = this._langPack.postprocessSynthetic(utterance, program, this._rng, forTarget);
        return utterance;
    }

    private async _generateAgent() : Promise<AgentTurn[]> {
        const agentTurns : AgentTurn[] = [];

        await Promise.all(this._partialDialogues.map((dlg) => dlg.run()));
        for (const derivation of this._agentGenerator.generate(this._agentGetContextPhrases(), '$dynamic')) {
            const agentReply : ExtendedAgentReplyRecord = derivation.value;

            const meaning = agentReply.meaning.optimize();
            this._stateValidator.validateAgent(meaning);
            const state = ThingTalkUtils.computeNewState(agentReply.dialogue.state, meaning, 'agent').optimize();

            agentTurns.push({
                dialogue: agentReply.dialogue,
                utterance: derivation.sentence,
                meaning: meaning,
                state: state,
                tag: agentReply.tag,
            });
        }
        return agentTurns;
    }

    private _generateUser(continuations : Map<PartialDialogue, Continuation>, agentTurns : AgentTurn[]) {
        const counters = new Map<PartialDialogue, number>();

        for (const derivation of this._userGenerator.generate(this._userGetContextPhrases(agentTurns), '$dynamic')) {
            // the derivation value for the user is directly the thingtalk user state
            // (unlike the agent)

            let meaning : Ast.DialogueState = derivation.value;
            meaning = meaning.optimize();
            assert(meaning !== null); // not-null even after optimize
            this._stateValidator.validateUser(meaning);

            const agentTurn = derivation.context!.value as AgentTurn;

            const agentUtterance = this._postprocessSentence(agentTurn.utterance, agentTurn.meaning, 'agent');
            const userUtterance = this._postprocessSentence(derivation.sentence, meaning, 'user');

            const dlg = agentTurn.dialogue;
            assert(dlg instanceof PartialDialogue);

            const context = dlg.state;
            const turn : DialogueTurn = {
                context: context !== null ? context.prettyprint() : null,
                // discard the agent utterance and meaning if the context is null (= at the first turn)
                // this will be the agent utterance "hello, how can i help you?" which we don't want to
                // use as training input
                agent: context !== null ? agentUtterance : null,
                agent_target: context !== null ? agentTurn.meaning.prettyprint() : null,
                user: userUtterance,
                user_target: meaning.prettyprint(),
            };

            const existing = continuations.get(dlg);
            const counter = (counters.get(dlg) ?? 0) + 1;
            counters.set(dlg, counter);
            if (!existing || coin(1/counter, this._rng)) {
                // we chose to continue this dialogue using `turn` as the continuation
                // either because there was no previously chosen continuation
                // for this dialogue, or because we won the random sampling
                const cmd = new Command(userUtterance, agentTurn.state, meaning);
                continuations.set(dlg, { cmd, turn });

                if (existing) {
                    // the previously chosen continuation was sampled out
                    // concat it to the previous turns in the dialogue and
                    // emit it as a complete dialogue
                    this._maybeAddCompleteDialog(dlg.turns.concat(existing.turn));
                }
            } else {
                // this continuation was sampled out
                // concat it to the previous turns in the dialogue and
                // emit it as a complete dialogue
                this._maybeAddCompleteDialog(dlg.turns.concat(turn));
            }
        }
    }

    private async _continueDialogues(continuations : Map<PartialDialogue, Continuation>) {
        // push the chosen continuation to each dialogue
        for (const [dlg, cont] of continuations)
            dlg.continue(cont);

        // filter out all dialogues that had no continuation at all
        this._partialDialogues = this._partialDialogues.filter((dlg) => continuations.has(dlg));
    }

    async nextTurn() : Promise<void> {
        this._turnIdx++;
        const start = Date.now();
        if (this._debug)
            console.log(`${this._logPrefix}Minibatch ${this._minibatchIdx}, turn ${this._turnIdx}`);

        this._agentGenerator.reset();
        this._userGenerator.reset();

        const agentTurns = await this._generateAgent();

        const continuations = new Map<PartialDialogue, Continuation>();
        await this._generateUser(continuations, agentTurns);

        await this._continueDialogues(continuations);

        const end = Date.now();
        if (this._debug)
            console.log(`${this._logPrefix}Turn took ${Math.round((end-start)/1000)} seconds`);
    }

    *complete() {
        for (const dlg of this._partialDialogues)
            this._maybeAddCompleteDialog(dlg.turns);

        //assert(this._completeDialogs.length > 0);
        for (let turnIdx = 0; turnIdx < this._options.maxTurns; turnIdx++) {
            for (const dialogue of this._completeDialogues[turnIdx])
                yield dialogue;
        }
    }
}

export interface DialogueGeneratorOptions {
    locale : string;
    timezone : string|undefined;
    minibatchSize : number;
    numMinibatches : number;
    idPrefix ?: string;
    logPrefix ?: string;
    debug : number;
    rng : () => number;

    policyModule ?: string;
    flags : { [key : string] : boolean };
    maxConstants ?: number;
    targetPruningSize : number;
    maxTurns : number;
    maxDepth : number;

    // simulator options
    thingpediaClient : Tp.BaseClient;
    schemaRetriever : SchemaRetriever;
    database ?: SimulationDatabase;

    // options passed to the templates
    onlyDevices ?: string[];
    whiteList ?: string;
}

/**
 * Generate a dataset of multi-turn dialogues.
 */
export default class DialogueGenerator extends stream.Readable {
    private _i : number;
    private _numMinibatches : number;
    private _options : DialogueGeneratorOptions;
    private _idPrefix : string;
    private _logPrefix : string;
    private _debug : number;
    private _langPack : I18n.LanguagePack;
    private _agentGenerator ! : SentenceGenerator;
    private _userGenerator ! : SentenceGenerator;
    private _policyModule ! : PolicyModule;
    private _stateValidator ! : ThingTalkUtils.StateValidator;
    private _simulator : SimulationDialogueAgent;

    private _initialized : boolean;
    private _minibatchIdx : number;

    constructor(options : DialogueGeneratorOptions) {
        super({ objectMode: true });

        this._i = 0;
        this._numMinibatches = options.numMinibatches;

        this._options = options;
        this._idPrefix = options.idPrefix || '';
        this._logPrefix = options.logPrefix || '';
        this._debug = options.debug;

        this._langPack = I18n.get(options.locale);

        this._initialized = false;
        this._simulator = new SimulationDialogueAgent({
            locale: options.locale,
            timezone: options.timezone,
            thingpediaClient: options.thingpediaClient,
            database: options.database,
            rng: options.rng,
            interactive: false
        });
        this._minibatchIdx = 0;
    }

    private async _initialize() {
        const options = this._options;

        if (options.policyModule)
            this._policyModule = await import(path.resolve(options.policyModule));
        else
            this._policyModule = TransactionPolicy;

        const agentOptions : SentenceGeneratorOptions = {
            locale: options.locale,
            timezone: options.timezone,
            rootSymbol: '$agent',
            forSide: 'agent',
            contextual: true,
            flags: options.flags,
            targetPruningSize: options.targetPruningSize,
            maxDepth: options.maxDepth,
            maxConstants: options.maxConstants || 5,
            debug: options.debug,
            logPrefix: options.logPrefix,
            rng: options.rng,
            thingpediaClient: options.thingpediaClient,
            entityAllocator: new Syntax.SequentialEntityAllocator({}),
            onlyDevices: options.onlyDevices,
            whiteList: options.whiteList,
        };
        this._agentGenerator = new SentenceGenerator(agentOptions);
        await this._agentGenerator.initialize();
        await this._policyModule.initializeTemplates(agentOptions, this._agentGenerator.langPack, this._agentGenerator, this._agentGenerator.tpLoader);

        const userOptions : SentenceGeneratorOptions = {
            locale: options.locale,
            timezone: options.timezone,
            rootSymbol: '$user',
            forSide: 'user',
            contextual: true,
            flags: options.flags,
            targetPruningSize: options.targetPruningSize,
            maxDepth: options.maxDepth,
            maxConstants: options.maxConstants || 5,
            debug: options.debug,
            logPrefix: options.logPrefix,
            rng: options.rng,
            thingpediaClient: options.thingpediaClient,
            entityAllocator: new Syntax.SequentialEntityAllocator({}),
            onlyDevices: options.onlyDevices,
            whiteList: options.whiteList,
        };
        this._userGenerator = new SentenceGenerator(userOptions);
        await this._userGenerator.initialize();
        await this._policyModule.initializeTemplates(agentOptions, this._userGenerator.langPack, this._userGenerator, this._userGenerator.tpLoader);

        this._stateValidator = new ThingTalkUtils.StateValidator(this._policyModule.MANIFEST);
    }

    private async _generateMinibatch() {
        if (!this._initialized) {
            await this._initialize();
            this._initialized = true;
        }

        const start = Date.now();
        let counter = 0;
        try {
            const generator = new MinibatchDialogueGenerator(this._agentGenerator,
                this._userGenerator, this._langPack, this._policyModule, this._simulator,
                this._stateValidator, this._options, this._minibatchIdx++);

            for (let turn = 0; turn < this._options.maxTurns; turn++)
                await generator.nextTurn();

            for (const turns of generator.complete()) {
                const dlg = {
                    id: this._idPrefix + '' + this._i++,
                    turns
                };
                this.push(dlg);
                counter ++;
            }
        } finally {
            const end = Date.now();
            if (this._debug)
                console.log(`${this._logPrefix}Minibatch took ${Math.round((end-start)/1000)} seconds and produced ${counter} dialogues`);
        }
    }

    _read() : void {
        if (this._minibatchIdx >= this._numMinibatches) {
            this.push(null);
            return;
        }

        this._generateMinibatch().catch((e) => {
            this.emit('error', e);
        });
    }
}
