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

const ThingTalk = require('thingtalk');

const Utils = require('../utils/misc-utils');
const I18n = require('../i18n');
const editDistance = require('../utils/edit-distance');

const Predictor = require('./predictor');

const SEMANTIC_PARSING_TASK = 'almond';
const NLU_TASK = 'almond_dialogue_nlu';
const NLG_TASK = 'almond_dialogue_nlg';
const NLG_QUESTION = 'what should the agent say ?';

module.exports = class LocalParserClient {
    constructor(modeldir, locale, platform, exactmatcher = null, tpClient = null, options = {}) {
        this._locale = locale;
        this._langPack = I18n.get(locale);
        this._tokenizer = this._langPack.getTokenizer();
        this._predictor = new Predictor(options.id || 'local', modeldir, options.nprocesses);

        this._exactmatcher = exactmatcher;
        this._tpClient = tpClient;
    }

    async start() {
        await this._predictor.start();
    }
    async stop() {
        await this._predictor.stop();
    }

    async sendUtterance(utterance, contextCode, contextEntities, options = {}) {
        let tokens, entities;
        if (options.tokenized) {
            tokens = utterance.split(' ');
            entities = Utils.makeDummyEntities(utterance);
            if (contextEntities) {
                // safety against weird properties
                for (let key of Object.getOwnPropertyNames(contextEntities)) {
                    if (/^(.+)_([0-9]+)$/.test(key))
                        entities[key] = contextEntities[key];
                }
            }
        } else {
            const tokenized = await this._tokenizer.tokenize(utterance);
            if (contextEntities)
                Utils.renumberEntities(tokenized, contextEntities);
            tokens = tokenized.tokens;
            entities = tokenized.entities;
        }

        let answer = undefined;
        if (options.answer)
            answer = options.answer;

        let result = null;
        let exact = null;

        if (tokens.length === 0) {
            result = [{
                code: ['bookkeeping', 'special', 'special:failed'],
                score: 'Infinity'
            }];
        } else if (tokens.length === 1 && (/^[A-Z]/.test(tokens[0]) || tokens[0] === '1' || tokens[0] === '0')) {
            // if the whole input is just an entity, return that as an answer
            result = [{
                code: ['bookkeeping', 'answer', tokens[0]],
                score: 'Infinity'
            }];
        } else if (options.expect === 'MultipleChoice') {
            const choices = await Promise.all((options.choices || []).map((choice) => this._tokenizer.tokenize(choice)));
            result = choices.map((choice, i) => {
                return {
                    code: ['bookkeeping', 'choice', String(i)],
                    score: -editDistance(tokens, choice.tokens)
                };
            });
            result.sort((a, b) => b.score - a.score);
        } else {
            if (this._exactmatcher)
                exact = this._exactmatcher.get(tokens);
        }

        if (result === null) {
            if (options.expect === 'Location') {
                result = [{
                    code: ['bookkeeping', 'answer', 'location:', '"', ...tokens, '"'],
                    score: 1
                }];
            } else {
                let candidates;
                if (contextCode)
                    candidates = await this._predictor.predict(contextCode.join(' '), tokens.join(' '), answer, NLU_TASK);
                else
                    candidates = await this._predictor.predict(tokens.join(' '), undefined, answer, SEMANTIC_PARSING_TASK);
                result = candidates.map((c) => {
                    return {
                        code: c.answer.split(' '),
                        score: c.score
                    };
               });
            }
        }
        if (exact !== null)
            result = exact.map((code) => ({ code, score: 'Infinity' })).concat(result);

        if (!options.skip_typechecking) {
            const schemas = new ThingTalk.SchemaRetriever(this._tpClient, null, true);

            result = await Promise.all(result.map(async (c) => {
                try {
                    const parsed = ThingTalk.NNSyntax.fromNN(c.code, entities);
                    await parsed.typecheck(schemas);
                    return {
                        code: c.code,
                        score: c.score
                    };
                } catch(e) {
                    return null;
                }
            }));

            result = result.filter((c) => c !== null);

            const programs = [result.map((r) => r.code)];
            ThingTalk.NNSyntax.applyCompatibility(this._locale, programs, entities, options.thingtalk_version);
        }

        return {
            result: 'ok',
            tokens: tokens,
            candidates: result,
            entities: entities
        };
    }

    async generateUtterance(contextCode, contextEntities, targetAct) {
        let candidates = this._predictor.predict(contextCode.join(' ') + ' ' + targetAct.join(' '), NLG_QUESTION, undefined, NLG_TASK);
        candidates = candidates.map((cand) => {
            return {
                answer: this._langPack.postprocessNLG(cand.answer, contextEntities),
                score: cand.score
            };
        });
        return candidates;
    }
};
