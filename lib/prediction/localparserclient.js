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

const Utils = require('../utils/misc-utils');
const I18n = require('../i18n');

const Predictor = require('./predictor');

const SEMANTIC_PARSING_TASK = 'almond';
const NLU_TASK = 'almond_dialogue_nlu';
const NLG_TASK = 'almond_dialogue_nlg';
const NLG_QUESTION = 'what should the agent say ?';

module.exports = class LocalParserClient {
    constructor(modeldir, locale) {
        this._locale = locale;
        this._langPack = I18n.get(locale);
        this._tokenizer = this._langPack.getTokenizer();
        this._predictor = new Predictor('local', modeldir);
    }

    async start() {
        await this._predictor.start();
    }
    async stop() {
        await this._predictor.stop();
        await this._tokenizer.end();
    }

    async tokenize(utterance, contextEntities) {
        const tokenized = await this._tokenizer.tokenize(utterance);
        Utils.renumberEntities(tokenized, contextEntities);
        return tokenized;

    }
    async sendUtterance(utterance, contextCode, contextEntities, options = {}) {
        let tokens, entities;
        if (options.tokenized) {
            tokens = utterance.split(' ');
            entities = Utils.makeDummyEntities(utterance);
            Object.assign(entities, contextEntities);
        } else {
            const tokenized = await this._tokenizer.tokenize(utterance);
            Utils.renumberEntities(tokenized, contextEntities);
            tokens = tokenized.tokens;
            entities = tokenized.entities;
        }

        let candidates;
        if (contextCode)
            candidates = await this._predictor.predict(contextCode.join(' '), tokens.join(' '), NLU_TASK);
        else
            candidates = await this._predictor.predict(tokens.join(' '), undefined, SEMANTIC_PARSING_TASK);

        candidates = candidates.map((cand) => {
            return {
                code: cand.answer.split(' '),
                score: cand.score
            };
        });
        return { tokens, candidates, entities };
    }

    async generateUtterance(contextCode, contextEntities, targetAct) {
        let candidates = this._predictor.predict(contextCode.join(' ') + ' ' + targetAct.join(' '), NLG_QUESTION, NLG_TASK);
        candidates = candidates.map((cand) => {
            return {
                answer: this._langPack.postprocessNLG(cand.answer, contextEntities),
                score: cand.score
            };
        });
        return candidates;
    }
};
