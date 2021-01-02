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

import * as Utils from '../utils/misc-utils';
import * as I18n from '../i18n';
import editDistance from '../utils/edit-distance';
import { EntityMap, renumberEntities } from '../utils/entity-utils';
import * as ThingTalkUtils from '../utils/thingtalk';

import Predictor from './predictor';
import ExactMatcherBuilder from './exactbuilder';
import {
    ParseOptions,
    PredictionCandidate,
    PredictionResult,
    GenerationResult,
    ExactMatcher
} from './types';

const SEMANTIC_PARSING_TASK = 'almond';
const NLU_TASK = 'almond_dialogue_nlu';
const NLG_TASK = 'almond_dialogue_nlg';
const NLG_QUESTION = 'what should the agent say ?';

export interface LocalParserOptions {
    id ?: string;
    nprocesses ?: number;
}

function compareScore(a : PredictionCandidate, b : PredictionCandidate) : number {
    if (a.score === b.score)
        return 0;
    if (a.score === 'Infinity')
        return -1;
    if (b.score === 'Infinity')
        return 1;
    return b.score - a.score;
}

export default class LocalParserClient {
    private _locale : string;
    private _langPack : I18n.LanguagePack;
    private _tokenizer : I18n.BaseTokenizer;
    private _predictor : Predictor;
    private _platform : Tp.BasePlatform|undefined;
    private _exactmatcher : ExactMatcher|undefined;
    private _tpClient : Tp.BaseClient|null;

    constructor(modeldir : string,
                locale : string,
                platform : Tp.BasePlatform|undefined,
                exactmatcher : ExactMatcher|undefined,
                tpClient : Tp.BaseClient|null = null,
                options : LocalParserOptions = {}) {
        this._locale = locale;
        this._langPack = I18n.get(locale);
        this._tokenizer = this._langPack.getTokenizer();
        this._predictor = new Predictor(options.id || 'local', modeldir, options.nprocesses);

        this._exactmatcher = exactmatcher;
        this._tpClient = tpClient;
    }

    async start() : Promise<void> {
        await Promise.all([
            this._predictor.start(),
            this._startExactMatcher()
        ]);
    }
    async stop() : Promise<void> {
        await this._predictor.stop();
    }

    private async _startExactMatcher() {
        if (this._exactmatcher)
            return;
        if (!this._platform || !this._tpClient)
            return;

        const prefs = this._platform.getSharedPreferences();
        const developerDir = prefs.get('developer-dir') as string|string[];
        if (!developerDir)
            return;
        const builder = new ExactMatcherBuilder({
            locale: this._locale,
            cachedir: this._platform.getCacheDir(),
            developerdir: Array.isArray(developerDir) ? developerDir : [developerDir],
            thingpediaClient: this._tpClient,
        });
        this._exactmatcher = await builder.load();
    }

    private _applyPreHeuristics(contextCode : string[]) : string[] {
        // remove "attribute:id = GENERIC_ENTITY_tt:device_id_*" from the context because
        // we never generate that in training

        const newCode = [];
        let inString = false;
        for (let i = 0; i < contextCode.length; i++) {
            const token = contextCode[i];
            if (token === '"')
                inString = !inString;
            if (inString) {
                newCode.push(token);
                continue;
            }
            if (token === 'attribute:id') {
                i += 2; // skip "attribute:id" and "=", the loop increment will skip GENERIC_ENTITY
                continue;
            }
            newCode.push(token);
        }
        return newCode;
    }

    private _applyPostHeuristics(programs : PredictionCandidate[], contextCode : string[]|undefined) {
        // only work on contextual
        if (!contextCode)
            return;

        if (contextCode[0] === '$dialogue' &&
            contextCode[1] === '@org.thingpedia.dialogue.transaction' &&
            contextCode[3] === 'sys_anything_else') {
            for (const prog of programs) {
                if (prog.code[0] === '$dialogue' &&
                    prog.code[1] === '@org.thingpedia.dialogue.transaction' &&
                    prog.code[3] === 'cancel')
                    prog.code[3] = 'end';
            }
        }
    }

    async sendUtterance(utterance : string,
                        contextCode : string[]|undefined,
                        contextEntities : EntityMap|undefined,
                        options : ParseOptions = {}) : Promise<PredictionResult> {
        let tokens : string[], entities : EntityMap;
        if (options.tokenized) {
            tokens = utterance.split(' ');
            entities = Utils.makeDummyEntities(utterance);
            if (contextEntities) {
                // safety against weird properties
                for (const key of Object.getOwnPropertyNames(contextEntities)) {
                    if (/^(.+)_([0-9]+)$/.test(key))
                        entities[key] = contextEntities[key];
                }
            }
        } else {
            const tokenized = await this._tokenizer.tokenize(utterance);
            if (contextEntities)
                renumberEntities(tokenized, contextEntities);
            tokens = tokenized.tokens;
            entities = tokenized.entities;
        }

        const answer = options.answer;

        let result : PredictionCandidate[]|null = null;
        let exact : string[][]|null = null;

        if (tokens.length === 0) {
            result = [{
                code: ['$failed', ';'],
                score: 'Infinity'
            }];
        } else if (tokens.length === 1 && (/^[A-Z]/.test(tokens[0]) || tokens[0] === '1' || tokens[0] === '0')) {
            // if the whole input is just an entity, return that as an answer
            result = [{
                code: ['$answer', '(', tokens[0], ')', ';'],
                score: 'Infinity'
            }];
        } else if (options.expect === 'MultipleChoice') {
            const choices = await Promise.all((options.choices || []).map((choice) => this._tokenizer.tokenize(choice)));
            result = choices.map((choice, i) => {
                return {
                    code: ['$choice', '(', String(i), ')', ';'],
                    score: -editDistance(tokens, choice.tokens)
                };
            });
            result.sort(compareScore);
        } else {
            if (this._exactmatcher)
                exact = this._exactmatcher.get(tokens);
        }

        if (result === null) {
            if (options.expect === 'Location') {
                result = [{
                    code: ['$answer', '(', 'new', 'Location', '(', '"', ...tokens, '"', ')', ')', ';'],
                    score: 1
                }];
            } else {
                if (contextCode)
                    contextCode = this._applyPreHeuristics(contextCode);

                let candidates;
                if (contextCode)
                    candidates = await this._predictor.predict(contextCode.join(' '), tokens.join(' '), answer, NLU_TASK, options.example_id);
                else
                    candidates = await this._predictor.predict(tokens.join(' '), undefined, answer, SEMANTIC_PARSING_TASK, options.example_id);
                result = candidates.map((c) => {
                    return {
                        code: c.answer.split(' '),
                        score: c.score
                    };
               });
            }
        }

        let result2 = result!; // guaranteed not null
        if (exact !== null)
            result2 = exact.map((code) : PredictionCandidate => ({ code, score: 'Infinity' })).concat(result2);

        this._applyPostHeuristics(result2, contextCode);

        if (!options.skip_typechecking) {
            const schemas = new ThingTalk.SchemaRetriever(this._tpClient!, null, true);

            result2 = (await Promise.all(result2.map(async (c) => {
                const parsed = await ThingTalkUtils.parsePrediction(c.code, entities, {
                    thingpediaClient: this._tpClient,
                    schemaRetriever: schemas
                });

                if (parsed) {
                    return {
                        code: ThingTalkUtils.serializePrediction(parsed, tokens, entities, {
                            locale: this._locale,
                            compatibility: options.thingtalk_version,
                            ignoreSentence: true
                        }),
                        score: c.score
                    };
                } else {
                    return null;
                }
            }))).filter(<T>(c : T) : c is Exclude<T, null> => c !== null);
        }

        return {
            result: 'ok',
            tokens: tokens,
            candidates: result2,
            entities: entities
        };
    }

    async generateUtterance(contextCode : string[], contextEntities : EntityMap, targetAct : string[]) : Promise<GenerationResult[]> {
        let candidates = await this._predictor.predict(contextCode.join(' ') + ' ' + targetAct.join(' '), NLG_QUESTION, undefined, NLG_TASK);
        candidates = candidates.map((cand) => {
            return {
                answer: this._langPack.postprocessNLG(cand.answer, contextEntities),
                score: cand.score
            };
        });
        return candidates;
    }
}
