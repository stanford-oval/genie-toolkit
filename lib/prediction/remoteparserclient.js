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
const Tp = require('thingpedia');
const qs = require('qs');

module.exports = class RemoteParserClient {
    constructor(baseUrl, locale, platform) {
        this._locale = locale;
        this._baseUrl = baseUrl + '/' + this._locale;
        this._platform = platform;
    }

    async start() {
    }
    async stop() {
    }

    async onlineLearn(utterance, code, store = 'automatic') {
        const data = {
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
        } catch (e) {
            console.error('Failed to send "' + utterance + '" to Almond-NNParser for learning: ' + e.message);
        }
        return result;
    }

    async sendUtterance(utterance, contextCode, contextEntities, options = {}) {
        const data = {
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

        return parsed;
    }

    async generateUtterance(contextCode, contextEntities, targetAct) {
        const data = {
            context: contextCode,
            entities: contextEntities,
            target: targetAct
        };
        const response = await Tp.Helpers.Http.post(`${this._baseUrl}/answer`, JSON.stringify(data), {
            dataContentType: 'application/json' //'
        });
        const parsed = JSON.parse(response);
        if (parsed.error)
            throw new Error('Error received from Genie server: ' + parsed.error);

        return parsed;
    }
};
