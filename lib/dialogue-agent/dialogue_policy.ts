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


import assert from 'assert';
import * as Tp from 'thingpedia';
import { Ast, SchemaRetriever } from 'thingtalk';

import ValueCategory from './value-category';
import { CancellationError } from './errors';
import * as I18n from '../i18n';
import SentenceGenerator, { SentenceGeneratorOptions } from '../sentence-generator/generator';
import { AgentReplyRecord } from '../sentence-generator/types';
import * as ThingTalkUtils from '../utils/thingtalk';
import type DialogueLoop from './dialogue-loop';
import type Conversation from './conversation';

const MAX_DEPTH = 7;
const TARGET_PRUNING_SIZES = [50, 100];

let TEMPLATE_FILE_PATH : string;
try {
    // try the path relative to our build location first (in dist/lib/dialogue-agent)
    TEMPLATE_FILE_PATH = require.resolve('../../../languages-dist/thingtalk/en/dialogue.genie');
} catch(e) {
    if (e.code !== 'MODULE_NOT_FOUND')
        throw e;
    try {
        // if that fails, try the location relative to our source directory
        // (in case we're running with ts-node)
        TEMPLATE_FILE_PATH = require.resolve('../../languages-dist/thingtalk/en/dialogue.genie');
    } catch(e) {
        if (e.code !== 'MODULE_NOT_FOUND')
            throw e;
        // if that still fails, we're probably in the "compile-template" call
        // in a clean build, so set ourselves empty (it will not matter)
        TEMPLATE_FILE_PATH = '';
    }
}

function arrayEqual<T>(a : T[], b : T[]) : boolean {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i])
            return false;
    }
    return true;
}

/*interface GeneratorOptions {
    locale : string;
    templateFiles : string[];
    flags : { [key : string] : boolean };
    rootSymbol ?: string;
    targetPruningSize : number;
    maxDepth : number;
    maxConstants : number;
    debug : number;
    rng : () => number;

    thingpediaClient ?: Tp.BaseClient;
    schemaRetriever ?: SchemaRetriever;
    onlyDevices ?: string[];
    whiteList ?: string;

    contextual : true;
    contextInitializer : ContextInitializer;
}*/

export default class DialoguePolicy {
    private _dlg : DialogueLoop;
    private _thingpedia : Tp.BaseClient;
    private _schemas : SchemaRetriever;
    private _locale : string;
    private _langPack : I18n.LanguagePack;
    private _rng : () => number;

    private _sentenceGenerator : SentenceGenerator<Ast.DialogueState|null, Ast.DialogueState, AgentReplyRecord<Ast.DialogueState>>|null;
    private _generatorDevices : string[]|null;
    private _generatorOptions : SentenceGeneratorOptions<Ast.DialogueState|null, Ast.DialogueState>|undefined;

    constructor(dlg : DialogueLoop,
                conversation : Conversation) {
        this._dlg = dlg;

        this._thingpedia = conversation.thingpedia;
        this._schemas = conversation.schemas;
        this._locale = conversation.locale;
        this._langPack = I18n.get(conversation.locale);

        this._rng = conversation.rng;
        assert(this._rng);

        this._sentenceGenerator = null;
        this._generatorDevices = null;
        this._generatorOptions = undefined;
    }

    private async _initializeGenerator(forDevices : string[]) {
        console.log('Initializing dialogue policy for devices: ' + forDevices.join(', '));

        this._generatorOptions = {
            contextual: true,
            rootSymbol: '$agent',
            flags: {
                // FIXME
                dialogues: true,
                inference: true,
                for_agent: true
            },
            rng: this._rng,
            locale: this._locale,
            templateFiles: [TEMPLATE_FILE_PATH],
            thingpediaClient: this._thingpedia,
            schemaRetriever: this._schemas,
            onlyDevices: forDevices,
            maxDepth: MAX_DEPTH,
            maxConstants: 5,
            targetPruningSize: TARGET_PRUNING_SIZES[0],
            debug: this._dlg.hasDebug ? 2 : 1,

            contextInitializer(state, functionTable, contextTable) {
                // ask the target language to extract the constants from the context
                if (state !== null) {
                    const constants = ThingTalkUtils.extractConstants(state);
                    sentenceGenerator.addConstantsFromContext(constants);
                }
                return functionTable.context!(state, contextTable);
            }
        };
        const sentenceGenerator = new SentenceGenerator<Ast.DialogueState|null, Ast.DialogueState, AgentReplyRecord<Ast.DialogueState>>(this._generatorOptions!);
        this._sentenceGenerator = sentenceGenerator;
        this._generatorDevices = forDevices;
        await this._sentenceGenerator.initialize();
    }

    private _extractDevices(state : Ast.DialogueState|null) : string[] {
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

    private async _ensureGeneratorForState(state : Ast.DialogueState|null) {
        const devices = this._extractDevices(state);
        if (this._generatorDevices && arrayEqual(this._generatorDevices, devices))
            return;
        await this._initializeGenerator(devices);
    }

    async handleAnswer(state : Ast.DialogueState|null, value : Ast.Value) : Promise<Ast.DialogueState|null> {
        if (state === null)
            return null;
        await this._ensureGeneratorForState(state);
        return this._sentenceGenerator!.invokeFunction('answer', state, value, this._sentenceGenerator!.contextTable);
    }

    private _generateDerivation(state : Ast.DialogueState|null) {
        let derivation;

        // try with a low pruning size first, because that's faster, and then increase
        // the pruning size if we don't find anything useful
        for (const pruningSize of TARGET_PRUNING_SIZES) {
            this._generatorOptions!.targetPruningSize = pruningSize;
            derivation = this._sentenceGenerator!.generateOne(state);
            if (derivation !== undefined)
                break;
        }
        return derivation;
    }

    async chooseAction(state : Ast.DialogueState|null) : Promise<[Ast.DialogueState, ValueCategory|null, string, number]> {
        await this._ensureGeneratorForState(state);
        const derivation = this._generateDerivation(state);
        if (derivation === undefined) {
            await this._dlg.fail();
            throw new CancellationError();
        }

        let sentence = derivation.toString();
        sentence = this._langPack.postprocessSynthetic(sentence, derivation.value.state, this._rng, 'agent');
        sentence = this._langPack.postprocessNLG(sentence, {});

        let expect : ValueCategory|null;
        if (derivation.value.end)
            expect = null;
        else if (derivation.value.expect)
            expect = ValueCategory.fromType(derivation.value.expect);
        else
            expect = ValueCategory.Command;
        if (expect === ValueCategory.RawString && !derivation.value.raw)
            expect = ValueCategory.Command;

        return [derivation.value.state, expect, sentence, derivation.value.numResults];
    }
}
