// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const ThingTalk = require('thingtalk');
const Tp = require('thingpedia');
const qs = require('qs');

const URL = 'https://almond-nl.stanford.edu';

module.exports = class ParserClient {
    constructor(baseUrl, locale, prefs, platform) {
        this._locale = locale || 'en_US';
        this._baseUrl = (baseUrl || URL) + '/' + this._locale;
        this._prefs = prefs;
        this._platform = platform;

        console.log('Using Almond-NNParser at ' + this._baseUrl);
    }

    onlineLearn(utterance, code, store = 'automatic') {
        const data = qs.stringify({
            q: utterance,
            target: code.join(' '),
            store: store,
            thingtalk_version: ThingTalk.version,
        });
        if (this._platform)
            data.developer_key = this._platform.getDeveloperKey();

        Tp.Helpers.Http.post(this._baseUrl + '/learn', data, { dataContentType: 'application/x-www-form-urlencoded' }).then(() => {
            console.log(`Sent "${utterance}" to Almond-NNParser for learning`);
        }).catch((e) => {
            console.error(`Failed to send "${utterance}" to Almond-NNParser for learning: ${e.message}`);
        });
    }

    async sendUtterance(utterance, context, expecting, choices) {
        const store = this._prefs.get('sabrina-store-log') || 'no';
        const data = {
            q: utterance,
            store: store,
            thingtalk_version: ThingTalk.version,
        };
        if (this._platform)
            data.developer_key = this._platform.getDeveloperKey();
        if (expecting)
            data.expect = String(expecting);
        if (choices)
            data.choices = choices.map((c) => c.title);

        if (this._prefs.get('experimental-contextual-model')) {
            const now = new Date;
            if (context.timeout > now) {
                data.context = context.code;
                data.entities = context.entities;
            } else {
                data.context = 'null';
                data.entities = {};
            }
        }
        const response = await Tp.Helpers.Http.post(`${this._baseUrl}/query`, JSON.stringify(data), {
            dataContentType: 'application/json' //'
        });

        const parsed = JSON.parse(response);

        if (parsed.error)
            throw new Error('Error received from Almond NLP server: ' + parsed.error);

        return parsed;
    }
};
