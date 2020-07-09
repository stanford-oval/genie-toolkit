// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2016-2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
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

    onlineLearn(utterance, code, store = 'automatic') {
        const data = {
            q: utterance,
            target: code.join(' '),
            store: store,
            thingtalk_version: ThingTalk.version,
        };
        if (this._platform)
            data.developer_key = this._platform.getDeveloperKey();

        Tp.Helpers.Http.post(this._baseUrl + '/learn', qs.stringify(data), { dataContentType: 'application/x-www-form-urlencoded' }).then(() => {
            console.log('Sent "' + utterance + '" to Almond-NNParser for learning');
        }).catch((e) => {
            console.error('Failed to send "' + utterance + '" to Almond-NNParser for learning: ' + e.message);
        });
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
            data.choices = options.choices.map((c) => c.title);

        console.log(`${this._baseUrl}/query`);
        const response = await Tp.Helpers.Http.post(`${this._baseUrl}/query`, JSON.stringify(data), {
            dataContentType: 'application/json' //'
        });

        const parsed = JSON.parse(response);

        if (parsed.error)
            throw new Error('Error received from Almond NLP server: ' + parsed.error);

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
