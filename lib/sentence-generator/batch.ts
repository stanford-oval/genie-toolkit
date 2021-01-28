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
import assert from 'assert';
import stream from 'stream';

import * as I18n from '../i18n';
import MultiMap from '../utils/multimap';
import { ReservoirSampler, } from '../utils/random';
import * as Utils from '../utils/entity-utils';
import * as ThingTalkUtils from '../utils/thingtalk';

import SentenceGenerator, {
    SentenceGeneratorOptions,
} from './generator';
import {
    ContextPhrase,
    AgentReplyRecord
} from './types';
import { Derivation } from './runtime';

interface BasicGeneratorOptions {
    targetPruningSize : number;
    maxDepth : number;
    maxConstants ?: number;
    idPrefix ?: string;
    locale : string;
    templateFiles : string[];
    flags : { [key : string] : boolean };
    debug : number;
    rng : () => number;

    // options passed to the templates
    thingpediaClient ?: Tp.BaseClient;
    onlyDevices ?: string[];
    whiteList ?: string;
}

/**
 * Generate a dataset of single-sentence commands and their associated logical forms.
 */
class BasicSentenceGenerator extends stream.Readable {
    private _idPrefix : string;
    private _locale : string;
    private _langPack : I18n.LanguagePack;
    private _rng : () => number;
    private _generator : SentenceGenerator<undefined, ThingTalkUtils.Input>;
    private _initialization : Promise<void>|null;
    private _i : number;

    constructor(options : BasicGeneratorOptions) {
        super({ objectMode: true });
        this._idPrefix = options.idPrefix || '';
        this._locale = options.locale;
        this._langPack = I18n.get(options.locale);
        this._rng = options.rng;
        this._generator = new SentenceGenerator({
            locale: options.locale,
            templateFiles: options.templateFiles,
            contextual: false,
            flags: options.flags,
            targetPruningSize: options.targetPruningSize,
            maxDepth: options.maxDepth,
            maxConstants: options.maxConstants || 5,
            debug: options.debug,
            rng: options.rng,

            thingpediaClient: options.thingpediaClient,
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
            this._generator.generate([], this._output.bind(this));
            this.emit('progress', this._generator.progress);
            this.push(null);
        }).catch((e) => {
            console.error(e);
            this.emit('error', e);
        });
    }

    private _postprocessSentence(derivation : Derivation<ThingTalkUtils.Input>, program : ThingTalkUtils.Input) {
        let utterance = derivation.toString();
        utterance = utterance.replace(/ +/g, ' ');
        utterance = this._langPack.postprocessSynthetic(utterance, program, this._rng, 'user');
        return utterance;
    }

    private _output(depth : number, derivation : Derivation<ThingTalkUtils.Input>) {
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
                locale: this._locale
            });
        } catch(e) {
            console.error(preprocessed);
            console.error(String(program));
            console.error(sequence);

            console.error(program.prettyprint().trim());
            this.emit('error', e);
            return;
        }
        let id = String(this._i++);
        id = this._idPrefix + depth + '000000000'.substring(0,9-id.length) + id;
        const flags = {
            synthetic: true
        };
        this.push({ depth, id, flags, preprocessed, target_code: sequence.join(' ') });
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
    constructor(public context : any = null,
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

interface StateValidator {
    load() : Promise<void>;
    validateUser(state : any) : void;
    validateAgent(state : any) : void;
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
    private _agentGenerator : SentenceGenerator<PartialDialogue, AgentReplyRecord<ThingTalkUtils.DialogueState>>;
    private _userGenerator : SentenceGenerator<AgentTurn, ThingTalkUtils.DialogueState>;
    private _langPack : I18n.LanguagePack;
    private _simulator : ThingTalkUtils.Simulator;
    private _stateValidator : StateValidator;
    private _minibatchSize : number;
    private _rng : () => number;
    private _options : DialogueGeneratorOptions;

    private _minibatchIdx : number;
    private _turnIdx : number;

    private _debug : boolean;

    private _partialDialogues : ReservoirSampler<PartialDialogue>;
    private _emptyDialogue : PartialDialogue;
    private _completeDialogues : Array<ReservoirSampler<Dialogue>>;

    constructor(agentGenerator : SentenceGenerator<PartialDialogue, AgentReplyRecord<ThingTalkUtils.DialogueState>>,
                userGenerator : SentenceGenerator<AgentTurn, ThingTalkUtils.DialogueState>,
                langPack : I18n.LanguagePack,
                simulator : ThingTalkUtils.Simulator,
                stateValidator : StateValidator,
                options : DialogueGeneratorOptions,
                minibatchIdx : number) {
        this._agentGenerator = agentGenerator;
        this._userGenerator = userGenerator;
        this._langPack = langPack;
        this._simulator = simulator;
        this._stateValidator = stateValidator;
        this._minibatchSize = options.minibatchSize;
        this._rng = options.rng;
        this._options = options;

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
        let utterance = derivation.toString();
        utterance = utterance.replace(/ +/g, ' ');
        utterance = this._langPack.postprocessSynthetic(utterance, program, this._rng, forTarget);
        return utterance;
    }

    private _generateAgent(partials : readonly PartialDialogue[]) : AgentTurn[] {
        const agentTurns : AgentTurn[] = [];
        this._agentGenerator.generate(partials, (depth : number, derivation : Derivation<AgentReplyRecord<ThingTalkUtils.DialogueState>>) => {
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
        });
        return agentTurns;
    }

    private _generateUser(continuations : MultiMap<PartialDialogue, Continuation>, agentTurns : AgentTurn[]) {
        this._userGenerator.generate(agentTurns, (depth, derivation) => {
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
        });
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
                    const { newDialogueState, newExecutorState } = await this._simulator.execute(userState, dlg.execState);
                    newDialogue.context = newDialogueState;
                    newDialogue.execState = newExecutorState;
                }
            }
        }
    }

    async nextTurn() : Promise<void> {
        this._turnIdx++;
        const start = Date.now();
        if (this._debug)
            console.log(`Minibatch ${this._minibatchIdx}, turn ${this._turnIdx}`);

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
            console.log(`Produced ${this._partialDialogues.counter} partial dialogs this turn`);
            console.log(`Turn took ${Math.round((end-start)/1000)} seconds`);
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

interface SimulationDatabase {
    has(key : string) : boolean;
    get(key : string) : Array<{ [key : string] : unknown }>|undefined;
}

interface DialogueGeneratorOptions {
    locale : string;
    minibatchSize : number;
    numMinibatches : number;
    idPrefix ?: string;
    debug : number;
    rng : () => number;

    policyFile ?: string;

    templateFiles : string[];
    flags : { [key : string] : boolean };
    maxConstants ?: number;
    targetPruningSize : number;
    maxTurns : number;
    maxDepth : number;

    // simulator options
    thingpediaClient ?: Tp.BaseClient;
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
    private _debug : number;
    private _langPack : I18n.LanguagePack;
    private _agentGenerator : SentenceGenerator<PartialDialogue, AgentReplyRecord<ThingTalkUtils.DialogueState>>;
    private _userGenerator : SentenceGenerator<AgentTurn, ThingTalkUtils.DialogueState>;
    private _stateValidator : StateValidator;
    private _simulator : ThingTalkUtils.Simulator;

    private _initialized : boolean;
    private _minibatchIdx : number;

    constructor(options : DialogueGeneratorOptions) {
        super({ objectMode: true });

        this._i = 0;
        this._numMinibatches = options.numMinibatches;

        this._options = options;
        this._idPrefix = options.idPrefix || '';
        this._debug = options.debug;

        this._langPack = I18n.get(options.locale);

        const agentOptions : SentenceGeneratorOptions<PartialDialogue, AgentReplyRecord<ThingTalkUtils.DialogueState>> = {
            locale: options.locale,
            templateFiles: options.templateFiles,
            rootSymbol: '$agent',
            contextual: true,
            flags: {},
            targetPruningSize: options.targetPruningSize,
            maxDepth: options.maxDepth,
            maxConstants: options.maxConstants || 5,
            debug: options.debug,
            rng: options.rng,
            thingpediaClient: options.thingpediaClient,
            onlyDevices: options.onlyDevices,
            whiteList: options.whiteList,

            contextInitializer: (partialDialogue : PartialDialogue, functionTable, contextTable) => {
                return functionTable.context!(partialDialogue.context, contextTable);
            }
        };
        Object.assign(agentOptions.flags, options.flags);
        agentOptions.flags.for_agent = true;
        this._agentGenerator = new SentenceGenerator<PartialDialogue, AgentReplyRecord<ThingTalkUtils.DialogueState>>(agentOptions);

        const userOptions : SentenceGeneratorOptions<AgentTurn, ThingTalkUtils.DialogueState> = {
            locale: options.locale,
            templateFiles: options.templateFiles,
            rootSymbol: '$user',
            contextual: true,
            flags: {},
            targetPruningSize: options.targetPruningSize,
            maxDepth: options.maxDepth,
            maxConstants: options.maxConstants || 5,
            debug: options.debug,
            rng: options.rng,
            thingpediaClient: options.thingpediaClient,
            onlyDevices: options.onlyDevices,
            whiteList: options.whiteList,

            contextInitializer: (agentTurn : AgentTurn, functionTable, contextTable) => {
                if (agentTurn.context === null) {
                    // first turn
                    return functionTable.context!(null, contextTable);
                } else {
                    return agentTurn.contextPhrases;
                }
            }
        };
        Object.assign(userOptions.flags, options.flags);
        userOptions.flags.for_user = true;
        this._userGenerator = new SentenceGenerator<AgentTurn, ThingTalkUtils.DialogueState>(userOptions);

        this._stateValidator = ThingTalkUtils.createStateValidator(options.policyFile);

        this._initialized = false;
        this._simulator = ThingTalkUtils.createSimulator({
            locale: options.locale,
            thingpediaClient: options.thingpediaClient,
            database: options.database,
            rng: options.rng,
            interactive: false
        });
        this._minibatchIdx = 0;
    }

    private async _generateMinibatch() {
        if (!this._initialized) {
            await this._userGenerator.initialize();
            await this._agentGenerator.initialize();
            await this._stateValidator.load();
            this._initialized = true;
        }

        const start = Date.now();
        let counter = 0;
        try {
            const generator = new MinibatchDialogueGenerator(this._agentGenerator,
                this._userGenerator, this._langPack, this._simulator,
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
                console.log(`Minibatch took ${Math.round((end-start)/1000)} seconds and produced ${counter} dialogues`);
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
