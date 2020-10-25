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


import express from 'express';
import bodyParser from 'body-parser';
import logger from 'morgan';
import errorhandler from 'errorhandler';
import qv from 'query-validation';
import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';

import * as Utils from '../lib/utils/misc-utils';
import Predictor from '../lib/prediction/predictor';
import * as I18n from '../lib/i18n';

function learn(req, res) {
    res.status(501).json({ error: 'Learning is not available with this Genie server' });
}

const SEMANTIC_PARSING_TASK = 'almond';
const NLU_TASK = 'almond_dialogue_nlu';
const NLG_TASK = 'almond_dialogue_nlg';
const NLG_QUESTION = 'what should the agent say ?';

async function tokenize(params, data, res) {
    const app = res.app;
    if (params.locale !== app.args.locale) {
        res.status(404).json({ error: 'Unsupported language' });
        return;
    }

    const tokenized = await app.backend.tokenizer.tokenize(data.q, data.expect || null);
    if (data.entities)
        Utils.renumberEntities(tokenized, data.entities);

    res.cacheFor(3600);
    res.json(tokenized);
}

async function runNLUPrediction(backend, tokens, entities, context, limit, skipTypechecking) {
    let candidates;
    if (context === undefined)
        candidates = await backend.nlu.predict(tokens.join(' '), undefined, SEMANTIC_PARSING_TASK);
    else
        candidates = await backend.nlu.predict(context.join(' '), tokens.join(' '), NLU_TASK);

    // HACK:
    for (let cand of candidates) {
        if (cand.answer === '$dialogue @org.thingpedia.dialogue.transaction.execute ; now => [ param:reviewCount ] of ( ( result ( @com.yelp.restaurant param:reviewCount ] ) ) filter param:id == " golden boy pizza " ^^com.yelp:restaurant ) => param:price:Enum(cheap,moderate,expensive,luxury) ^^com.yelp:restaurant ) => notify ;')
            cand.answer = '$dialogue @org.thingpedia.dialogue.transaction.execute ; now => [ param:reviewCount ] of ( ( result ( @com.yelp.restaurant [ 1 ] ) ) filter param:id == " golden boy pizza " ^^com.yelp:restaurant ) => notify ;';

        cand.answer = cand.answer.replace(/param:(reviewCount|rating) == enum:/g, 'param:price == enum:');
    }
    console.log(candidates);

    if (skipTypechecking) {
        return candidates.map((c) => {
            return {
                code: c.answer.split(' '),
                score: c.score
            };
       }).slice(0, limit);
    }

    candidates = await Promise.all(candidates.map(async (c) => {
        try {
            const parsed = ThingTalk.NNSyntax.fromNN(c.answer.split(' '), entities);
            await parsed.typecheck(backend.schemas);
            return {
                code: c.answer.split(' '),
                score: c.score
            };
        } catch(e) {
            console.error(e);
            return null;
        }
    }));

    candidates = candidates.filter((c) => c !== null);

    if (limit >= 0)
        return candidates.slice(0, limit);
    else
        return candidates;
}

async function queryNLU(params, data, res) {
    const query = data.q;
    const thingtalk_version = data.thingtalk_version;
    const expect = data.expect || null;
    const isTokenized = !!data.tokenized;
    const app = res.app;

    if (thingtalk_version !== ThingTalk.version) {
        res.status(400).json({ error: 'Invalid ThingTalk version' });
        return;
    }
    if (params.locale !== app.args.locale) {
        res.status(400).json({ error: 'Unsupported language' });
        return;
    }

    // emulate the frontend classifier for API compatibility
    const intent = {
        question: 0,
        command: 1,
        chatty: 0,
        other: 0
    };

    let tokenized;
    if (isTokenized) {
        tokenized = {
            tokens: query.split(' '),
            entities: {},
        };
        if (data.entities) {
            // safety against weird properties
            for (let key of Object.getOwnPropertyNames(data.entities)) {
                if (/^(.+)_([0-9]+)$/.test(key))
                    tokenized[key] = data.entities[key];
            }
        }
    } else {
        tokenized = await app.backend.tokenizer.tokenize(query, expect);
        if (data.entities)
            Utils.renumberEntities(tokenized, data.entities);
    }

    const tokens = tokenized.tokens;
    let result;
    if (tokens.length === 0) {
        result = [{
            code: ['bookkeeping', 'special', 'special:failed'],
            score: 'Infinity'
        }];
    } else {
        result = await runNLUPrediction(app.backend, tokens, tokenized.entities,
                                        data.context ? data.context.split(' ') : undefined,
                                        data.limit ? parseInt(data.limit) : 5,
                                        !!data.skip_typechecking);
    }

    res.json({
         candidates: result,
         tokens: tokens,
         entities: tokenized.entities,
         intent
    });
}

async function runNLGPrediction(backend, context, entities, targetAct, limit) {
    let candidates = await backend.nlg.predict(context + ' ' + targetAct, NLG_QUESTION, NLG_TASK);

    candidates = candidates.slice(0, limit);

    candidates = candidates.map((cand) => {
        cand.answer = backend.i18n.postprocessNLG(cand.answer, entities);
        return cand;
    });

    return candidates;
}

async function queryNLG(params, data, res) {
    const app = res.app;

    if (params.locale !== app.args.locale) {
        res.status(400).json({ error: 'Unsupported language' });
        return;
    }

    const result = await runNLGPrediction(app.backend, data.context, data.entities, data.target,
                                          data.limit ? parseInt(data.limit) : 5);

    res.json({
         candidates: result,
    });
}

const QUERY_PARAMS = {
    q: 'string',
    store: '?string',
    access_token: '?string',
    thingtalk_version: '?string',
    limit: '?integer',
    expect: '?string',
    choices: '?array',
    context: '?string',
    entities: '?object',
    tokenized: 'boolean',
    skip_typechecking: 'boolean',
    developer_key: '?string',
};
const NLG_PARAMS = {
    context: 'string',
    entities: 'object',
    target: 'string',
};

export function initArgparse(subparsers) {
    const parser = subparsers.add_parser('server', {
        add_help: true,
        description: "Expose a Genie-compatible NLP API over HTTP."
    });
    parser.add_argument('-p', '--port', {
        required: false,
        help: "HTTP port to listen on",
        default: 8400,
    });
    parser.add_argument('--nlu-model', {
        required: true,
        help: "Path to the NLU model, pointing to a model directory.",
    });
    parser.add_argument('--nlg-model', {
        required: false,
        help: "Path to the NLG model, pointing to a model directory.",
    });
    parser.add_argument('--thingpedia', {
        required: true,
        help: 'Path to ThingTalk file containing class definitions.'
    });
    parser.add_argument('-l', '--locale', {
        required: false,
        default: 'en-US',
        help: `BGP 47 locale tag of the language to evaluate (defaults to 'en-US', English)`
    });
    parser.add_argument('--debug', {
        action: 'store_true',
        help: 'Enable debugging.',
        default: true
    });
    parser.add_argument('--no-debug', {
        action: 'store_false',
        dest: 'debug',
        help: 'Disable debugging.',
    });
}

export async function execute(args) {
    const tpClient = new Tp.FileClient(args);
    const schemas = new ThingTalk.SchemaRetriever(tpClient, null, true);
    const app = express();

    const i18n = I18n.get(args.locale);
    app.backend = {
        schemas,
        i18n,
        tokenizer: i18n.getTokenizer(),
        nlu: new Predictor('nlu', args.nlu_model, 1)
    };
    app.backend.nlu.start();
    if (args.nlg_model && args.nlg_model !== args.nlu_model) {
        app.backend.nlg = new Predictor('nlg', args.nlg_model, 1);
        app.backend.nlg.start();
    } else {
        app.backend.nlg = app.backend.nlu;
    }

    app.args = args;

    app.set('port', args.port);
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(logger('dev'));

    app.use((req, res, next) => {
        res.set('Access-Control-Allow-Origin', '*');
        next();
    });

    app.post('/:locale/query', qv.validatePOST(QUERY_PARAMS, { accept: 'application/json', json: true }), (req, res, next) => {
        queryNLU(req.params, req.body, res).catch(next);
    });

    app.post('/:locale/answer', qv.validatePOST(NLG_PARAMS, { accept: 'application/json', json: true }), (req, res, next) => {
        queryNLG(req.params, req.body, res).catch(next);
    });

    app.post('/:locale/tokenize', qv.validatePOST({ q: 'string', entities: '?object' }, { accept: 'application/json', json: true }), (req, res, next) => {
        tokenize(req.params, req.body, res).catch(next);
    });

    app.post('/:locale/learn', learn);

    // if we get here, we have a 404 error
    app.use('/', (req, res) => {
        res.status(404).json({ error: 'Invalid endpoint' });
    });
    app.use(errorhandler());

    const server = app.listen(app.get('port'));

    await new Promise((resolve, reject) => {
        process.on('SIGINT', resolve);
        process.on('SIGTERM', resolve);
    });

    await app.backend.nlu.stop();
    if (app.backend.nlg !== app.backend.nlu)
        await app.backend.nlg.stop();
    server.close();
}
