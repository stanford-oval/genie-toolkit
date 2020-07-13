// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
"use strict";

const assert = require('assert');
const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const ValueCategory = require('./value-category');
const { CancellationError } = require('./errors');
const I18n = require('../i18n');
const SentenceGenerator  = require('../sentence-generator/generator');
const TargetLanguages = require('../languages');

const MAX_DEPTH = 7;
const TARGET_PRUNING_SIZE = 50;

function arrayEqual(a, b) {
    if (a.length !== b.length)
        return false;
    for (var i = 0; i < a.length; i++) {
        if (a[i] !== b[i])
            return false;
    }
    return true;
}

module.exports = class DialoguePolicy {
    constructor(dlg) {
        this._dlg = dlg;
        const manager = dlg.manager;

        this._thingpedia = manager.thingpedia;
        this._schemas = manager.schemas;
        this._locale = manager.locale;
        this._langPack = I18n.get(manager.locale);

        this._rng = manager.rng;
        assert(this._rng);

        this._sentenceGenerator = null;
        this._generatorDevices = null;
    }

    async _initializeGenerator(forDevices) {
        console.log('Initializing dialogue policy for devices: ' + forDevices.join(', '));
        const target = TargetLanguages.get('thingtalk');
        const sentenceGenerator = new SentenceGenerator({
            contextual: true,
            rootSymbol: '$agent',
            flags: {
                // FIXME
                dialogues: true,
                inference: true,
            },
            rng: this._rng,
            locale: this._locale,
            templateFiles: [require.resolve('../../languages/thingtalk/en/dialogue.genie')],
            targetLanguage: 'thingtalk',
            thingpediaClient: this._thingpedia,
            schemaRetriever: this._schemas,
            onlyDevices: forDevices,
            maxDepth: MAX_DEPTH,
            targetPruningSize: TARGET_PRUNING_SIZE,
            debug: 1,

            contextInitializer(state, functionTable) {
                // ask the target language to extract the constants from the context
                const constants = target.extractConstants(state);
                sentenceGenerator.addConstantsFromContext(constants);
                const tagger = functionTable.get('context');
                return tagger(state);
            }
        });
        this._sentenceGenerator = sentenceGenerator;
        this._generatorDevices = forDevices;
        await this._sentenceGenerator.initialize();
    }

    _extractDevices(state) {
        let devices = new Set;
        state.visit(new class extends Ast.NodeVisitor {
            visitDeviceSelector(selector) {
                devices.add(selector.kind);
            }
        });
        devices = Array.from(devices);
        devices.sort();
        return devices;
    }

    async _ensureGeneratorForState(state) {
        const devices = this._extractDevices(state);
        if (this._generatorDevices && arrayEqual(this._generatorDevices, devices))
            return;
        await this._initializeGenerator(devices);
    }

    async handleAnswer(state, value) {
        await this._ensureGeneratorForState(state);
        return this._sentenceGenerator.invokeFunction('answer', state, value);
    }

    async chooseAction(state) {
        await this._ensureGeneratorForState(state);
        const derivation = this._sentenceGenerator.generateOne(state);
        if (derivation === undefined) {
            await this._dlg.fail();
            throw new CancellationError();
        }

        let sentence = derivation.toString();
        sentence = this._langPack.postprocessSynthetic(sentence, derivation.value.state, this._rng, 'agent');
        sentence = this._langPack.postprocessNLG(sentence, {});

        let expect;
        if (derivation.value.end)
            expect = null;
        else if (derivation.value.expect)
            expect = ValueCategory.fromType(derivation.value.expect);
        else
            expect = ValueCategory.Command;
        if (expect === ValueCategory.RawString && !derivation.value.raw)
            expect = ValueCategory.Command;

        return [derivation.value.state, expect, sentence];
    }
};
