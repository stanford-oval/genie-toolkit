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


import * as ThingTalk from 'thingtalk';
import * as Tp from 'thingpedia';
import qs from 'qs';

import { EntityMap } from '../utils/entity-utils';
import {
    ParseOptions,
    PredictionCandidate,
    PredictionResult,
    GenerationResult,
    ExactMatcher,
} from './types';
import ExactMatcherBuilder from './exactbuilder';

interface OnlineLearnArguments {
    q : string;
    target : string;
    store : string;
    thingtalk_version : string;
    developer_key ?: string|null;
}
interface QueryArguments {
    q : string;
    store : string;
    thingtalk_version : string;
    tokenized ?: boolean;
    skip_typechecking ?: boolean;
    context ?: string;
    entities ?: EntityMap;
    developer_key ?: string|null;
    expect ?: string;
    choices ?: string[];
    answer ?: string;
}

export default class RemoteParserClient {
    private _locale : string;
    private _baseUrl : string;
    private _platform : Tp.BasePlatform|undefined;
    private _tpClient : Tp.BaseClient|undefined;
    private _exactmatcher : ExactMatcher|undefined;

    constructor(baseUrl : string, locale : string,
                platform ?: Tp.BasePlatform,
                tpClient ?: Tp.BaseClient) {
        this._locale = locale;
        this._baseUrl = baseUrl + '/' + this._locale;
        this._platform = platform;
        this._tpClient = tpClient;
    }

    async start() {
        if (!this._platform || !this._tpClient)
            return;

        const prefs = this._platform.getSharedPreferences();
        const developerDir = prefs.get('developer-dir') as string|string[];
        if (!developerDir)
            return;
        const builder = new ExactMatcherBuilder({
            locale: this._locale,
            timezone: this._platform.timezone,
            cachedir: this._platform.getCacheDir(),
            developerdir: Array.isArray(developerDir) ? developerDir : [developerDir],
            thingpediaClient: this._tpClient,
        });
        this._exactmatcher = await builder.load();
    }
    async stop() {
    }

    async onlineLearn(utterance : string, code : string[], store = 'automatic') {
        const data : OnlineLearnArguments = {
            q: utterance,
            target: code.join(' '),
            store: store,
            thingtalk_version: ThingTalk.version,
        };
        if (this._platform)
            data.developer_key = this._platform.getDeveloperKey();

        let result;
        try {
            result = await Tp.Helpers.Http.post(this._baseUrl + '/learn', qs.stringify(data), { dataContentType: 'application/x-www-form-urlencoded' });
            console.log('Sent "' + utterance + '" to Almond-NNParser for learning');
        } catch(e) {
            console.error('Failed to send "' + utterance + '" to Almond-NNParser for learning: ' + e.message);
        }
        return result;
    }

    async sendUtterance(utterance : string,
                        contextCode : string[]|undefined,
                        contextEntities : EntityMap|undefined,
                        options : ParseOptions = {}) : Promise<PredictionResult> {
        const data : QueryArguments = {
            q: utterance,
            store: options.store || 'no',
            thingtalk_version: ThingTalk.version,
            tokenized: options.tokenized,
            skip_typechecking: options.skip_typechecking
        };
        if (contextCode !== undefined) {
            data.context = contextCode.join(' ');
            data.entities = contextEntities;
        }
        if (this._platform)
            data.developer_key = this._platform.getDeveloperKey();
        if (options.expect)
            data.expect = String(options.expect);
        if (options.choices)
            data.choices = options.choices;
        if (options.answer)
            data.answer = options.answer;

        const response = await Tp.Helpers.Http.post(`${this._baseUrl}/query`, JSON.stringify(data), {
            dataContentType: 'application/json' //'
        });

        const parsed = JSON.parse(response);

        if (parsed.error)
            throw new Error('Error received from NLP server: ' + parsed.error);
        if (this._exactmatcher && data.expect !== 'MultipleChoice') {
            const exact = this._exactmatcher.get(parsed.tokens);
            if (exact)
                parsed.candidates = exact.map((code) : PredictionCandidate => ({ code, score: 'Infinity' })).concat(parsed.candidates);
        }

        return parsed;
    }

    async generateUtterance(contextCode : string[],
                            contextEntities : EntityMap,
                            targetAct : string[]) : Promise<GenerationResult[]> {
        const data = {
            context: contextCode.join(' '),
            entities: contextEntities,
            target: targetAct.join(' ')
        };
        const response = await Tp.Helpers.Http.post(`${this._baseUrl}/answer`, JSON.stringify(data), {
            dataContentType: 'application/json' //'
        });
        const parsed = JSON.parse(response);
        if (parsed.error)
            throw new Error('Error received from Genie server: ' + parsed.error);

        return parsed.candidates;
    }
}
