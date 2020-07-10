// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');

const ValueCategory = require('./value-category');
const { CancellationError } = require('./errors');
const I18n = require('../i18n');
const SentenceGenerator  = require('../sentence-generator/generator');
const TargetLanguages = require('../languages');

const MAX_DEPTH = 7;
const TARGET_PRUNING_SIZE = 100;

module.exports = class DialoguePolicy {
    constructor(dlg) {
        this._dlg = dlg;
        const manager = dlg.manager;
        this._langPack = I18n.get(manager.locale);

        this._rng = manager.rng;
        assert(this._rng);

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
            locale: manager.locale,
            templateFiles: [require.resolve('../../languages/thingtalk/en/dialogue.genie')],
            targetLanguage: 'thingtalk',
            thingpediaClient: manager.thingpedia,
            schemaRetriever: manager.schemas,
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
    }

    async init() {
        await this._sentenceGenerator.initialize();
        return this;
    }

    handleAnswer(value) {
        // TODO
        return null;
    }

    async chooseAction(state) {
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
