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

const TokenizerService = require('../../lib/tokenizer');
const Predictor = require('../../lib/predictor');
const Utils = require('../../lib/utils');
const I18n = require('../../lib/i18n');

const NLU_TASK = 'almond_dialogue_nlu';
const NLG_TASK = 'almond_dialogue_nlg';
const NLG_QUESTION = 'what should the agent say ?';
const POLICY_QUESTION = 'what should the agent do ?';
const POLICY_TASK = 'almond_dialogue_policy';

class LocalParserClient {
    constructor(modeldir, locale) {
        this._locale = locale;
        this._tokenizer = TokenizerService.get('local');
        this._predictor = new Predictor('local', modeldir);
        this._langPack = I18n.get(locale);
    }

    async start() {
        await this._predictor.start();
    }
    async stop() {
        await this._predictor.stop();
        await this._tokenizer.end();
    }

    async tokenize(utterance, contextEntities) {
        const tokenized = await this._tokenizer.tokenize(this._locale, utterance);
        Utils.renumberEntities(tokenized, contextEntities);
        return tokenized;

    }
    async sendUtterance(utterance, tokenized, contextCode, contextEntities) {
        let tokens, entities;
        if (tokenized) {
            tokens = utterance.split(' ');
            entities = Utils.makeDummyEntities(utterance);
            Object.assign(entities, contextEntities);
        } else {
            const tokenized = await this._tokenizer.tokenize(this._locale, utterance);
            Utils.renumberEntities(tokenized, contextEntities);
            tokens = tokenized.tokens;
            entities = tokenized.entities;
        }

        let candidates = await this._predictor.predict(contextCode.join(' '), tokens.join(' '), NLU_TASK);
        candidates = candidates.map((cand) => {
            return {
                code: cand.answer.split(' '),
                score: cand.score
            };
        });
        return { tokens, candidates, entities };
    }
    async queryPolicy(contextCode, contextEntities) {
        return this._predictor.predict(contextCode.join(' '), POLICY_QUESTION, POLICY_TASK);
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
}

class RemoteParserClient {
    constructor(baseUrl, locale) {
        this._locale = locale;
        this._baseUrl = baseUrl + '/' + this._locale;
    }

    async start() {}
    async stop() {}

    async tokenize(utterance, contextEntities) {
        const data = {
            q: utterance,
        };

        let response;
        if (contextEntities !== undefined) {
            data.entities = contextEntities;

            response = await Tp.Helpers.Http.post(`${this._baseUrl}/tokenize`, JSON.stringify(data), {
                dataContentType: 'application/json'
            });
        } else {
            let url = `${this._baseUrl}/tokenize?${qs.stringify(data)}`;

            response = await Tp.Helpers.Http.get(url);
        }
        const parsed = JSON.parse(response);

        if (parsed.error)
            throw new Error('Error received from Genie-Parser server: ' + parsed.error);

        return parsed;
    }

    async sendUtterance(utterance, tokenized, contextCode, contextEntities) {
        const data = {
            q: utterance,
            store: 'no',
            thingtalk_version: ThingTalk.version,
        };

        if (contextCode !== undefined) {
            data.context = contextCode.join(' ');
            data.entities = contextEntities;
            data.tokenized = tokenized;
            data.skip_typechecking = true;
        }
        const response = await Tp.Helpers.Http.post(`${this._baseUrl}/query`, JSON.stringify(data), {
            dataContentType: 'application/json'
        });
        const parsed = JSON.parse(response);
        if (parsed.error)
            throw new Error('Error received from Genie server: ' + parsed.error);

        return parsed;
    }

    async generateUtterance(contextCode, contextEntities, targetAct) {
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

        return parsed;
    }
}

module.exports = {
    get(url, locale) {
        if (url.startsWith('file://'))
            return new LocalParserClient(url.substring('file://'.length), locale);
        else
            return new RemoteParserClient(url, locale);
    }
};
