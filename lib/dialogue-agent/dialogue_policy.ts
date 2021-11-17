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

import path from 'path';
import assert from 'assert';
import * as Tp from 'thingpedia';
import { Ast, Type, SchemaRetriever, Syntax } from 'thingtalk';

import * as I18n from '../i18n';
import SentenceGenerator, { SentenceGeneratorOptions } from '../sentence-generator/generator';
import { AgentReplyRecord, PolicyModule } from '../sentence-generator/types';
import * as ThingTalkUtils from '../utils/thingtalk';
import { EntityMap } from '../utils/entity-utils';
import { Derivation } from '../sentence-generator/runtime';

import * as TransactionPolicy from '../templates/transactions';

const MAX_DEPTH = 8;
const TARGET_PRUNING_SIZES = [15, 50, 100, 200];

function arrayEqual<T>(a : T[], b : T[]) : boolean {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i])
            return false;
    }
    return true;
}

interface DialoguePolicyOptions {
    thingpedia : Tp.BaseClient;
    schemas : SchemaRetriever;
    locale : string;
    timezone : string|undefined;
    extraFlags : Record<string, boolean>;
    anonymous : boolean;
    policyModule ?: string;

    rng : () => number;
    debug : number;
}

interface PolicyResult {
    state : Ast.DialogueState;
    end : boolean;
    expect : Type|null;
    raw : boolean;
    utterance : string;
    entities : EntityMap;
    numResults : number;
}

export default class DialoguePolicy {
    private _thingpedia : Tp.BaseClient;
    private _schemas : SchemaRetriever;
    private _locale : string;
    private _timezone : string|undefined;
    private _langPack : I18n.LanguagePack;
    private _rng : () => number;
    private _debug : number;
    private _anonymous : boolean;
    private _extraFlags : Record<string, boolean>;

    private _sentenceGenerator : SentenceGenerator|null;
    private _generatorDevices : string[]|null;
    private _generatorOptions : SentenceGeneratorOptions|undefined;
    private _entityAllocator : Syntax.SequentialEntityAllocator;
    private _policyModuleName : string|undefined;
    private _policyModule ! : PolicyModule;

    constructor(options : DialoguePolicyOptions) {
        this._thingpedia = options.thingpedia;
        this._schemas = options.schemas;
        this._locale = options.locale;
        this._timezone = options.timezone;
        this._langPack = I18n.get(options.locale);
        this._entityAllocator = new Syntax.SequentialEntityAllocator({}, { timezone: this._timezone });

        this._rng = options.rng;
        assert(this._rng);
        this._debug = options.debug;
        this._anonymous = options.anonymous;
        this._extraFlags = options.extraFlags;
        this._policyModuleName = options.policyModule;

        this._sentenceGenerator = null;
        this._generatorDevices = null;
        this._generatorOptions = undefined;
    }

    async initialize() {
        if (this._policyModule)
            return;
        if (this._policyModuleName)
            this._policyModule = await import(path.resolve(this._policyModuleName));
        else
            this._policyModule = TransactionPolicy;
    }

    private async _initializeGenerator(forDevices : string[]) {
        console.log('Initializing dialogue policy for devices: ' + forDevices.join(', '));

        this._generatorOptions = {
            contextual: true,
            rootSymbol: '$agent',
            forSide: 'agent',
            flags: {
                dialogues: true,
                inference: true,
                anonymous: this._anonymous,
                ...this._extraFlags
            },
            rng: this._rng,
            locale: this._locale,
            timezone: this._timezone,
            thingpediaClient: this._thingpedia,
            schemaRetriever: this._schemas,
            entityAllocator: this._entityAllocator,
            onlyDevices: forDevices,
            maxDepth: MAX_DEPTH,
            maxConstants: 5,
            targetPruningSize: TARGET_PRUNING_SIZES[0],
            debug: this._debug,
        };
        const sentenceGenerator = new SentenceGenerator(this._generatorOptions!);
        this._sentenceGenerator = sentenceGenerator;
        this._generatorDevices = forDevices;
        await this._sentenceGenerator.initialize();
        await this._policyModule.initializeTemplates(this._generatorOptions, this._langPack, this._sentenceGenerator, this._sentenceGenerator.tpLoader);
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

    private async _ensureGeneratorForState(state : Ast.DialogueState|Ast.Program|null) {
        const devices = this._extractDevices(state);
        if (this._generatorDevices && arrayEqual(this._generatorDevices, devices))
            return;
        await this._initializeGenerator(devices);
    }

    async handleAnswer(state : Ast.DialogueState|null, value : Ast.Value) : Promise<Ast.DialogueState|null> {
        if (state === null)
            return null;
        if (!this._policyModule.interpretAnswer)
            return null;
        await this._ensureGeneratorForState(state);
        return this._policyModule.interpretAnswer(state, value, this._sentenceGenerator!.tpLoader, this._sentenceGenerator!.contextTable);
    }

    private _generateDerivation(state : Ast.DialogueState|null) {
        let derivation : Derivation<AgentReplyRecord>|undefined;

        // try with a low pruning size first, because that's faster, and then increase
        // the pruning size if we don't find anything useful
        for (const pruningSize of TARGET_PRUNING_SIZES) {
            this._generatorOptions!.targetPruningSize = pruningSize;
            this._sentenceGenerator!.reset(true);

            this._entityAllocator.reset();
            if (state !== null) {
                const constants = ThingTalkUtils.extractConstants(state, this._sentenceGenerator!.tpLoader.describer);
                this._sentenceGenerator!.addConstantsFromContext(constants);
            }
            const contextPhrases = this._policyModule.getContextPhrasesForState(state, this._sentenceGenerator!.tpLoader,
                this._sentenceGenerator!.contextTable);
            if (contextPhrases === null)
                return undefined;

            derivation = this._sentenceGenerator!.generateOne(contextPhrases, '$agent');
            if (derivation !== undefined)
                break;
        }
        return derivation;
    }

    async chooseAction(state : Ast.DialogueState|null) : Promise<PolicyResult|undefined> {
        await this._ensureGeneratorForState(state);

        const derivation = this._generateDerivation(state);
        if (derivation === undefined)
            return derivation;

        let utterance = derivation.chooseBestSentence();
        utterance = this._langPack.postprocessSynthetic(utterance, derivation.value.state, this._rng, 'agent');

        return {
            state: derivation.value.state,
            end: derivation.value.end,
            expect: derivation.value.expect,
            raw: derivation.value.raw,
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
}
