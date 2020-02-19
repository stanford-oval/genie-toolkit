// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const express = require('express');
const bodyParser = require('body-parser');
const logger = require('morgan');
const errorhandler = require('errorhandler');
const qv = require('query-validation');
const Tp = require('thingpedia');
const ThingTalk = require('thingtalk');

const Utils = require('../lib/utils');
const TokenizerService = require('../lib/tokenizer');
const Predictor = require('../lib/predictor');

function learn(req, res) {
    res.status(501).json({ error: 'Learning is not available with this Genie server' });
}

const NLU_TASK = 'almond_dialogue_nlu';
const NLG_TASK = 'almond_dialogue_nlg';
const NLG_QUESTION = 'what should the agent say ?';

async function tokenize(params, data, service, res) {
    const app = res.app;
    if (params.locale !== app.args.locale) {
        res.status(404).json({ error: 'Unsupported language' });
        return;
    }

    const tokenized = await service.tokenizer.tokenize(params.locale, data.q, data.expect || null);
    if (data.entities)
        Utils.renumberEntities(tokenized, data.entities);

    res.cacheFor(3600);
    res.json(tokenized);
}

async function runNLUPrediction(backend, tokens, entities, context, limit, skipTypechecking) {
    let candidates = await backend.nlu.predict(context.join(' '), tokens.join(' '), NLU_TASK);
    if (skipTypechecking)
        return candidates.slice(0, limit);

    candidates = await Promise.all(candidates.map(async (c) => {
        try {
            const parsed = ThingTalk.NNSyntax.fromNN(c.code, entities);
            await parsed.typecheck(backend.schemas);
            return c;
        } catch(e) {
            return null;
        }
    }));

    candidates = candidates.filter((c) => c !== null);

    if (limit >= 0)
        return candidates.slice(0, limit);
    else
        return candidates;
}

async function queryNLU(params, data, service, res) {
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
        tokenized = await service.tokenizer.tokenize(params.locale, query, expect);
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

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('server', {
            addHelp: true,
            description: "Expose a Genie-compatible NLP API over HTTP."
        });
        parser.addArgument(['-p', '--port'], {
            required: false,
            help: "HTTP port to listen on",
            defaultValue: 8400,
        });
        parser.addArgument('--nlu-model', {
            required: true,
            help: "Path to the NLU model, pointing to a model directory.",
        });
        parser.addArgument('--nlg-model', {
            required: true,
            help: "Path to the NLU model, pointing to a model directory.",
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the language to evaluate (defaults to 'en-US', English)`
        });
        parser.addArgument('--debug', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Enable debugging.',
            defaultValue: true
        });
        parser.addArgument('--no-debug', {
            nargs: 0,
            action: 'storeFalse',
            dest: 'debug',
            help: 'Disable debugging.',
        });
    },

    async execute(args) {
        const tpClient = new Tp.FileClient(args);
        const schemas = new ThingTalk.SchemaRetriever(tpClient, null, true);
        const app = express();

        app.backend = {
            schemas,
            tokenizer: TokenizerService.get('local'),
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

        app.get('/:locale/query', qv.validateGET(QUERY_PARAMS, { json: true }), (req, res, next) => {
            queryNLU(req.params, req.query, req.app.service, res).catch(next);
        });

        app.get('/:locale/tokenize', qv.validateGET({ q: 'string', expect: '?string', entities: '?object' }, { json: true }), (req, res, next) => {
            tokenize(req.params, req.query, req.app.service, res).catch(next);
        });

        app.post('/:locale/query', qv.validatePOST(QUERY_PARAMS, { json: true }), (req, res, next) => {
            queryNLU(req.params, req.body, req.app.service, res).catch(next);
        });

        app.post('/:locale/tokenize', qv.validatePOST({ q: 'string', entities: '?object' }, { json: true }), (req, res, next) => {
            tokenize(req.params, req.body, req.app.service, res).catch(next);
        });

        app.post('/:locale/learn',
            qv.validatePOST({ q: 'string', store: 'string', access_token: '?string', thingtalk_version: 'string', target: 'string', owner: '?string' }, { json: true }),
            learn);

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
        app.backend.tokenizer.end();
    }
};
