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


import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';
import assert from 'assert';
import stream from 'stream';
import * as path from 'path';

import * as I18n from '../i18n';
import MultiMap from '../utils/multimap';
import { ReservoirSampler, } from '../utils/random';
import * as Utils from '../utils/entity-utils';
import * as ThingTalkUtils from '../utils/thingtalk';
import { SimulationDatabase } from '../dialogue-agent/simulator/types';
import * as TransactionPolicy from '../templates/transactions';

import SentenceGenerator, {
    SentenceGeneratorOptions,
} from './generator';
import {
    ContextPhrase,
    PolicyModule
} from './types';
import { Derivation } from './runtime';

interface BasicGeneratorOptions {
    targetPruningSize : number;
    maxDepth : number;
    maxConstants ?: number;
    idPrefix ?: string;
    locale : string;
    timezone : string|undefined;
    templateFiles : string[];
    flags : { [key : string] : boolean };
    debug : number;
    rng : () => number;

    // options passed to the templates
    thingpediaClient : Tp.BaseClient;
    onlyDevices ?: string[];
    whiteList ?: string;
}

/**
 * Generate a dataset of single-sentence commands and their associated logical forms.
 */
class BasicSentenceGenerator extends stream.Readable {
    private _idPrefix : string;
    private _locale : string;
    private _timezone : string|undefined;
    private _langPack : I18n.LanguagePack;
    private _rng : () => number;
    private _generator : SentenceGenerator;
    private _initialization : Promise<void>|null;
    private _i : number;

    constructor(options : BasicGeneratorOptions) {
        super({ objectMode: true });
        this._idPrefix = options.idPrefix || '';
        this._locale = options.locale;
        this._timezone = options.timezone;
        this._langPack = I18n.get(options.locale);
        this._rng = options.rng;
        this._generator = new SentenceGenerator({
            locale: options.locale,
            timezone: options.timezone,
            templateFiles: options.templateFiles,
            forSide: 'user',
            contextual: false,
            flags: options.flags,
            targetPruningSize: options.targetPruningSize,
            maxDepth: options.maxDepth,
            maxConstants: options.maxConstants || 5,
            debug: options.debug,
            rng: options.rng,

            thingpediaClient: options.thingpediaClient,
            entityAllocator: new ThingTalk.Syntax.SequentialEntityAllocator({}, { timezone: options.timezone }),
            onlyDevices: options.onlyDevices,
            whiteList: options.whiteList
        });
        this._generator.on('progress', (value : number) => {
            this.emit('progress', value);
        });

        this._initialization = null;
        this._i = 0;
    }

    _read() : void {
        if (this._initialization === null)
            this._initialization = this._generator.initialize();

        this._initialization!.then(() => {
            for (const derivation of this._generator.generate([], '$root'))
                this._output(derivation);
            this.emit('progress', this._generator.progress);
            this.push(null);
        }).catch((e) => {
            console.error(e);
            this.emit('error', e);
        });
    }

    private _postprocessSentence(derivation : Derivation<ThingTalk.Ast.Input>, program : ThingTalk.Ast.Input) {
        let utterance = derivation.sampleSentence(this._rng);
        utterance = utterance.replace(/ +/g, ' ');
        utterance = this._langPack.postprocessSynthetic(utterance, program, this._rng, 'user');
        return utterance;
    }

    private _output(derivation : Derivation<ThingTalk.Ast.Input>) {
        const program = derivation.value.optimize();
        assert(program !== null); // not-null even after optimize
        let preprocessed = this._postprocessSentence(derivation, program);
        const tokens = preprocessed.split(' ');
        const entities = Utils.makeDummyEntities(preprocessed);
        const tokenized = { tokens, entities };
        const contextEntities = {};
        Utils.renumberEntities(tokenized, contextEntities);
        preprocessed = tokenized.tokens.join(' ');

        let sequence;
        try {
            sequence = ThingTalkUtils.serializePrediction(program, [], tokenized.entities, {
                locale: this._locale,
                timezone: this._timezone,
            });
        } catch(e) {
            console.error(preprocessed);
            console.error(program.prettyprint().trim());
            console.error(sequence);

            this.emit('error', e);
            return;
        }
        let id = String(this._i++);
        id = this._idPrefix + derivation.depth + '000000000'.substring(0,9-id.length) + id;
        const flags = {
            synthetic: true
        };
        this.push({ id, flags, preprocessed, target_code: sequence.join(' ') });
    }
}


interface DialogueTurn {
    context : string|null;
    agent : string|null;
    agent_target : string|null;
    user : string;
    user_target : string;
}
type Dialogue = DialogueTurn[];

class PartialDialogue {
    constructor(public context : ThingTalk.Ast.DialogueState|null = null,
                public turns : DialogueTurn[] = [],
                public execState : any = undefined) {
    }
}

interface AgentTurn {
    dlg : PartialDialogue;
    context : unknown;
    contextPhrases : ContextPhrase[];
    utterance : string|null;
    state : any|null;
    target : string|null;
}

interface Continuation {
    userState : any;
    newTurn : DialogueTurn;
}

const FACTORS = [50, 75, 75, 100];

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
    private _simulator : ThingTalkUtils.Simulator;
    private _stateValidator : ThingTalkUtils.StateValidator;
    private _minibatchSize : number;
    private _rng : () => number;
    private _options : DialogueGeneratorOptions;
    private _logPrefix : string;

    private _minibatchIdx : number;
    private _turnIdx : number;

    private _debug : boolean;

    private _partialDialogues : ReservoirSampler<PartialDialogue>;
    private _emptyDialogue : PartialDialogue;
    private _completeDialogues : Array<ReservoirSampler<Dialogue>>;

    constructor(agentGenerator : SentenceGenerator,
                userGenerator : SentenceGenerator,
                langPack : I18n.LanguagePack,
                policy : PolicyModule,
                simulator : ThingTalkUtils.Simulator,
                stateValidator : ThingTalkUtils.StateValidator,
                options : DialogueGeneratorOptions,
                minibatchIdx : number) {
        this._agentGenerator = agentGenerator;
        this._userGenerator = userGenerator;
        this._langPack = langPack;
        this._policy = policy;
        this._simulator = simulator;
        this._stateValidator = stateValidator;
        this._minibatchSize = options.minibatchSize;
        this._rng = options.rng;
        this._options = options;
        this._logPrefix = options.logPrefix || '';

        this._minibatchIdx = minibatchIdx;
        this._turnIdx = 0;

        this._debug = true;

        this._partialDialogues = new ReservoirSampler(Math.ceil(this._minibatchSize), this._rng);
        this._emptyDialogue = new PartialDialogue();
        this._maybeAddPartialDialog(this._emptyDialogue);
        this._completeDialogues = [];
        for (let turnIdx = 0; turnIdx < options.maxTurns; turnIdx++) {
            const factor = turnIdx < FACTORS.length ? FACTORS[turnIdx] : FACTORS[FACTORS.length-1];
            this._completeDialogues[turnIdx] = new ReservoirSampler(Math.ceil(this._minibatchSize * factor), this._rng);
        }
    }

    private *_agentGetContextPhrases(partials : readonly PartialDialogue[]) {
        for (const dlg of partials) {
            const phrases = this._policy.getContextPhrasesForState(dlg.context, this._agentGenerator.tpLoader,
                this._agentGenerator.contextTable);
            if (phrases !== null) {
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
            if (agentTurn.context === null) {
                // first turn
                for (const phrase of this._policy.getContextPhrasesForState!(null, this._userGenerator.tpLoader, this._userGenerator.contextTable)!) {
                    // override the context because we need the context in _generateUser
                    phrase.context = agentTurn;
                    yield phrase;
                }
            } else {
                for (const phrase of agentTurn.contextPhrases) {
                    // override the context because we need the context in _generateUser
                    phrase.context = agentTurn;
                    yield phrase;
                }
            }
        }
    }

    private _maybeAddCompleteDialog(dlg : PartialDialogue) {
        assert(dlg.turns.length > 0);
        this._completeDialogues[dlg.turns.length-1].add(dlg.turns);
    }

    private _maybeAddPartialDialog(dlg : PartialDialogue) {
        const discarded = this._partialDialogues.add(dlg);
        if (discarded !== undefined)
            this._maybeAddCompleteDialog(discarded);
        return discarded !== dlg;
    }

    private _postprocessSentence(derivation : Derivation<unknown>,
                                 program : ThingTalkUtils.DialogueState,
                                 forTarget : 'user'|'agent') : string {
        let utterance = derivation.sampleSentence(this._rng);
        utterance = utterance.replace(/ +/g, ' ');
        utterance = this._langPack.postprocessSynthetic(utterance, program, this._rng, forTarget);
        return utterance;
    }

    private _generateAgent(partials : readonly PartialDialogue[]) : AgentTurn[] {
        const agentTurns : AgentTurn[] = [];
        this._agentGenerator.reset();
        for (const derivation of this._agentGenerator.generate(this._agentGetContextPhrases(partials), '$agent')) {
            // derivation.dlg is the PartialDialogue that is being continued
            // derivation.value is the object returned by the root semantic function, with:
            // - state (the thingtalk state)
            // - context (the context info to pass to the semantic function of the user)
            // - tags (context tags to set when generating user sentences)
            // - other properties only relevant to inference time we don't care about

            // set the turn of the agent
            let state = derivation.value.state;
            state = state.optimize();
            assert(state !== null); // not-null even after optimize
            this._stateValidator.validateAgent(state);
            const utterance = this._postprocessSentence(derivation, state, 'agent');

            const dlg = derivation.context!.value;
            assert(dlg instanceof PartialDialogue);
            const prediction = ThingTalkUtils.computePrediction(dlg.context, state, 'agent');
            const target = prediction.prettyprint();

            agentTurns.push({
                dlg,
                context: derivation.value.context,
                contextPhrases: derivation.value.contextPhrases,
                utterance,
                state,
                target
            });
        }
        return agentTurns;
    }

    private _generateUser(continuations : MultiMap<PartialDialogue, Continuation>, agentTurns : AgentTurn[]) {
        this._userGenerator.reset();
        for (const derivation of this._userGenerator.generate(this._userGetContextPhrases(agentTurns), '$user')) {
            // the derivation value for the user is directly the thingtalk user state
            // (unlike the agent)

            let state = derivation.value as any;
            state = state.optimize();
            assert(state !== null); // not-null even after optimize
            this._stateValidator.validateUser(state);
            const utterance = this._postprocessSentence(derivation, state, 'user');

            const agentTurn = derivation.context!.value as AgentTurn;
            const dlg = agentTurn.dlg;
            assert(dlg instanceof PartialDialogue);
            assert(dlg === this._emptyDialogue || agentTurn.state);
            const prediction = ThingTalkUtils.computePrediction(agentTurn.state, state, 'user');
            const target = prediction.prettyprint();

            continuations.put(dlg, {
                userState: state,
                newTurn: {
                    context: dlg.context !== null ? dlg.context.prettyprint() : null,
                    agent: agentTurn.utterance,
                    agent_target: agentTurn.target,
                    user: utterance,
                    user_target: target,
                },
            });
        }
    }

    private async _continueOneDialogue(dlg : PartialDialogue, continuations : MultiMap<PartialDialogue, Continuation>) {
        const ourContinuations = continuations.get(dlg);

        if (ourContinuations.length === 0) {
            // if we have no continuations, mark this dialog as complete
            this._maybeAddCompleteDialog(dlg);
        } else {
            for (const { userState, newTurn } of ourContinuations) {
                const newDialogue = new PartialDialogue(dlg.context, dlg.turns.concat([newTurn]),
                    dlg.execState);

                if (this._maybeAddPartialDialog(newDialogue)) {
                    try {
                        const { newDialogueState, newExecutorState } = await this._simulator.execute(userState, dlg.execState);
                        newDialogue.context = newDialogueState;
                        newDialogue.execState = newExecutorState;
                    } catch(e) {
                        console.error(`Failed to execute dialogue`);
                        for (const turn of newDialogue.turns) {
                            console.log('A: ' + turn.agent);
                            console.log('U: ' + turn.user);
                        }
                        console.error(userState.prettyprint());
                        throw e;
                    }
                }
            }
        }
    }

    async nextTurn() : Promise<void> {
        this._turnIdx++;
        const start = Date.now();
        if (this._debug)
            console.log(`${this._logPrefix}Minibatch ${this._minibatchIdx}, turn ${this._turnIdx}`);

        const partials = this._partialDialogues.sampled;
        this._partialDialogues.reset();

        const continuations = new MultiMap<PartialDialogue, Continuation>();

        let agentTurns : AgentTurn[] = [];
        if (this._turnIdx > 1) { // turnIdx is 1-based because we incremented it already
            agentTurns = this._generateAgent(partials);
        } else {
            agentTurns = [{
                dlg: this._emptyDialogue,
                context: null,
                contextPhrases: [],
                utterance: '',
                state: null,
                target: null,
            }];
        }
        this._generateUser(continuations, agentTurns);

        for (const dlg of partials)
            await this._continueOneDialogue(dlg, continuations);

        const end = Date.now();
        if (this._debug) {
            console.log(`${this._logPrefix}Produced ${this._partialDialogues.counter} partial dialogs this turn`);
            console.log(`${this._logPrefix}Turn took ${Math.round((end-start)/1000)} seconds`);
        }
    }

    *complete() {
        for (const dlg of this._partialDialogues)
            this._maybeAddCompleteDialog(dlg);

        //assert(this._completeDialogs.length > 0);
        for (let turnIdx = 0; turnIdx < this._options.maxTurns; turnIdx++) {
            for (const dialogue of this._completeDialogues[turnIdx])
                yield dialogue;
        }
    }
}

interface DialogueGeneratorOptions {
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
    database ?: SimulationDatabase;

    // options passed to the templates
    onlyDevices ?: string[];
    whiteList ?: string;
}

/**
 * Generate a dataset of multi-turn dialogues.
 */
class DialogueGenerator extends stream.Readable {
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
    private _simulator : ThingTalkUtils.Simulator;

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
        this._simulator = ThingTalkUtils.createSimulator({
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
            entityAllocator: new ThingTalk.Syntax.SequentialEntityAllocator({}, { timezone: options.timezone }),
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
            entityAllocator: new ThingTalk.Syntax.SequentialEntityAllocator({}, { timezone: options.timezone }),
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

export {
    BasicSentenceGenerator,
    DialogueGenerator
};
