
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

import * as I18n from '../i18n';
import * as ThingTalkUtils from '../utils/thingtalk';

import SentenceGenerator, { SentenceGeneratorOptions } from '../sentence-generator/generator';
import { AgentReplyRecord, ContextPhrase, SemanticAction } from '../sentence-generator/types';
import { Derivation, NonTerminal, Replaceable } from '../sentence-generator/runtime';
import { PolicyModule } from './policy';

const MAX_DEPTH = 8;
const TARGET_PRUNING_SIZE = 15;

function arrayEqual<T>(a : T[], b : T[]) : boolean {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i])
            return false;
    }
    return true;
}


interface InferenceTimeSentenceGeneratorOptions {
    thingpediaClient : Tp.BaseClient;
    schemaRetriever : SchemaRetriever;
    locale : string;
    timezone : string|undefined;
    extraFlags : Record<string, boolean>;
    anonymous : boolean;
    policy : PolicyModule;

    rng : () => number;
    debug : number;
}

/**
 * Wrapper over {@link SentenceGenerator} that initializes the generator with
 * the minimal set of relevant skills.
 */
export default class InferenceTimeSentenceGenerator {
    private readonly _options : InferenceTimeSentenceGeneratorOptions;
    private readonly _langPack : I18n.LanguagePack;
    private _sentenceGenerator : SentenceGenerator|null;
    private _generatorOptions : SentenceGeneratorOptions|null;
    private _generatorDevices : string[]|null;
    private _entityAllocator : Syntax.SequentialEntityAllocator;

    constructor(options : InferenceTimeSentenceGeneratorOptions) {
        this._options = options;
        this._langPack = I18n.get(options.locale);
        this._entityAllocator = new Syntax.SequentialEntityAllocator({});

        this._sentenceGenerator = null;
        this._generatorOptions = null;
        this._generatorDevices = null;
    }

    get langPack() {
        return this._langPack;
    }
    get tpLoader() {
        return this._sentenceGenerator!.tpLoader;
    }
    get contextTable() {
        return this._sentenceGenerator!.contextTable;
    }
    get entities() {
        return this._entityAllocator.entities;
    }

    reset(hard ?: boolean) {
        if (!this._sentenceGenerator)
            return;
        this._sentenceGenerator.reset(hard);
    }

    addDynamicRule<ArgTypes extends unknown[], ResultType>(expansion : NonTerminal[],
                                                           sentence : Replaceable,
                                                           semanticAction : SemanticAction<ArgTypes, ResultType>) : void {
        this._sentenceGenerator!.addDynamicRule(expansion, sentence, semanticAction);
    }

    /**
     * Initialize the sentence generator given the current state of the dialogue.
     *
     * This method must be called before any call to {@link generate}, {@link tpLoader},
     * {@link contextTable}.
     *
     * @param state
     */
    async initialize(state : Ast.DialogueState|Ast.Program|null) {
        const devices = this._extractDevices(state);
        if (this._generatorDevices && arrayEqual(this._generatorDevices, devices)) {
            this._sentenceGenerator!.reset(true);
            return;
        }
        await this._initializeGenerator(devices);
    }

    private async _initializeGenerator(forDevices : string[]) {
        console.log('Initializing dialogue policy for devices: ' + forDevices.join(', '));

        this._generatorOptions = {
            ...this._options,
            contextual: true,
            forSide: 'agent',
            flags: {
                dialogues: true,
                inference: true,
                anonymous: this._options.anonymous,
                ...this._options.extraFlags
            },
            entityAllocator: this._entityAllocator,
            onlyDevices: forDevices,
            maxDepth: MAX_DEPTH,
            maxConstants: 5,
            targetPruningSize: TARGET_PRUNING_SIZE,
        };
        const sentenceGenerator = new SentenceGenerator(this._generatorOptions);
        this._sentenceGenerator = sentenceGenerator;
        this._generatorDevices = forDevices;
        await this._sentenceGenerator.initialize();
        await this._options.policy.initializeTemplates(this._generatorOptions, this._langPack,
            this._sentenceGenerator, this._sentenceGenerator.tpLoader);
    }

    private _extractDevices(state : Ast.DialogueState|Ast.Program|null) : string[] {
        if (state === null)
            return [];
        const devices = new Set<string>();
        state.visit(new class extends Ast.NodeVisitor {
            visitDeviceSelector(selector : Ast.DeviceSelector) : boolean {
                devices.add(selector.kind);
                return true;
            }
        });
        const deviceArray = Array.from(devices);
        deviceArray.sort();
        return deviceArray;
    }

    generate(state : Ast.DialogueState|null, contextPhrases : ContextPhrase[], nonTerm : string) : Derivation<AgentReplyRecord>|undefined {
        this._entityAllocator.reset();
        if (state !== null) {
            const constants = ThingTalkUtils.extractConstants(state, this._entityAllocator);
            this._sentenceGenerator!.addConstantsFromContext(constants);
        }
        return this._sentenceGenerator!.generateOne(contextPhrases, nonTerm);
    }

    /*
    async chooseAction(state : Ast.DialogueState|null) : Promise<PolicyResult|undefined> {
        await this._ensureGeneratorForState(state);

        const derivation = this._generateDerivation(state);
        if (derivation === undefined)
            return derivation;

        let utterance = derivation.chooseBestSentence();
        utterance = this._langPack.postprocessSynthetic(utterance, derivation.value.meaning, this._rng, 'agent');

        const newState = ThingTalkUtils.computeNewState(state, derivation.value.meaning, 'agent');
        return {
            state: newState,
            end: /* TODO *//* false,
            expect: /* TODO *//* null,
            raw: /* TODO *//* false,
            utterance,
            entities: this._entityAllocator.entities,
            numResults: derivation.value.numResults
        };
    }

    async getFollowUp(state : Ast.DialogueState) : Promise<Ast.DialogueState|null> {
        await this._ensureGeneratorForState(state);
        if (!this._policyModule.getFollowUp)
            return null;
        return this._policyModule.getFollowUp(state, this._sentenceGenerator!.tpLoader, this._sentenceGenerator!.contextTable);
    }

    async getNotificationState(appName : string|null, program : Ast.Program, result : Ast.DialogueHistoryResultItem) {
        await this._ensureGeneratorForState(program);
        return (this._policyModule.notification ?? TransactionPolicy.notification)(appName, program, result);
    }

    async getAsyncErrorState(appName : string|null, program : Ast.Program, error : Ast.Value) {
        await this._ensureGeneratorForState(program);
        return (this._policyModule.notifyError ?? TransactionPolicy.notifyError)(appName, program, error);
    }

    async getInitialState() {
        await this._ensureGeneratorForState(null);
        if (!this._policyModule.initialState)
            return null;
        return this._policyModule.initialState(this._sentenceGenerator!.tpLoader);
    }
    */
}
