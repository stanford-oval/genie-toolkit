// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020-2021 The Board of Trustees of the Leland Stanford Junior University
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
import { Ast, SchemaRetriever, Syntax } from 'thingtalk';
import assert from 'assert';
import stream from 'stream';
import * as path from 'path';

import * as I18n from '../i18n';
import { coin, ReservoirSampler, } from '../utils/random';
import * as ThingTalkUtils from '../utils/thingtalk';
import { DialogueTurn } from '../dataset-tools/parsers';
import { SimulationDatabase } from '../thingtalk-dialogues/simulator/types';
import SimulationDialogueAgent from '../thingtalk-dialogues/simulator/simulation-thingtalk-executor';
import { StateValidator } from '../thingtalk-dialogues/state-validator';
import * as TransactionPolicy from '../transaction-dialogues';

import SentenceGenerator, { SentenceGeneratorOptions } from './generator';
import SynthesisDialogue, {
    AgentTurn, Continuation, ExtendedAgentReplyRecord
} from '../thingtalk-dialogues/synthesis-dialogue';

import {
    Command,
    PolicyModule,
} from '../thingtalk-dialogues';
import { ReplacedResult } from '../utils/template-string';

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
    private _stateValidator : StateValidator;
    private _minibatchSize : number;
    private _rng : () => number;
    private _options : DialogueGeneratorOptions;
    private _logPrefix : string;

    private _minibatchIdx : number;
    private _turnIdx : number;

    private _debug : boolean;

    private _partialDialogues : SynthesisDialogue[];
    private _completeDialogues : Array<ReservoirSampler<DialogueTurn[]>>;

    constructor(agentGenerator : SentenceGenerator,
                userGenerator : SentenceGenerator,
                langPack : I18n.LanguagePack,
                policy : PolicyModule,
                simulator : SimulationDialogueAgent,
                stateValidator : StateValidator,
                options : DialogueGeneratorOptions,
                minibatchIdx : number) {
        this._agentGenerator = agentGenerator;
        this._userGenerator = userGenerator;
        this._langPack = langPack;
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
            this._partialDialogues.push(new SynthesisDialogue({
                agentGenerator: agentGenerator,
                userGenerator: userGenerator,
                policy: policy,
                simulator: simulator,
                locale: options.locale,
                timezone: options.timezone,
                schemaRetriever: options.schemaRetriever,
                flags: options.flags,
                debug: options.debug,
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
        for (const dlg of this._partialDialogues)
            yield* dlg.getAgentContextPhrases();
    }

    private *_userGetContextPhrases(agentTurns : readonly AgentTurn[]) {
        for (const agentTurn of agentTurns)
            yield* agentTurn.dialogue.getUserContextPhrases(agentTurn);
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

    private _generateUser(continuations : Map<SynthesisDialogue, Continuation>, agentTurns : AgentTurn[]) {
        const counters = new Map<SynthesisDialogue, number>();

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
            assert(dlg instanceof SynthesisDialogue);

            const context = dlg.state;
            const turn : DialogueTurn = {
                context: context !== null ? context.prettyprint() : null,
                // discard the agent utterance and meaning if the context is null (= at the first turn)
                // this will be the agent utterance "hello, how can i help you?" which we don't want to
                // use as training input
                agent: context !== null ? agentUtterance : null,
                agent_target: context !== null ? agentTurn.meaning.prettyprint() : null,
                intermediate_context: null,
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

    private async _continueDialogues(continuations : Map<SynthesisDialogue, Continuation>) {
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

        const continuations = new Map<SynthesisDialogue, Continuation>();
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
    private _stateValidator ! : StateValidator;
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
            schemaRetriever: options.schemaRetriever,
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
            schemaRetriever: options.schemaRetriever,
            entityAllocator: new Syntax.SequentialEntityAllocator({}, { timezone: options.timezone }),
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
            schemaRetriever: options.schemaRetriever,
            entityAllocator: new Syntax.SequentialEntityAllocator({}, { timezone: options.timezone }),
            onlyDevices: options.onlyDevices,
            whiteList: options.whiteList,
        };
        this._userGenerator = new SentenceGenerator(userOptions);
        await this._userGenerator.initialize();
        await this._policyModule.initializeTemplates(agentOptions, this._userGenerator.langPack, this._userGenerator, this._userGenerator.tpLoader);

        this._stateValidator = new StateValidator(this._policyModule.MANIFEST);
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
