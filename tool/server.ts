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

import * as argparse from 'argparse';
import express from 'express';
import bodyParser from 'body-parser';
// FIXME
//import logger from 'morgan';
import errorhandler from 'errorhandler';
import * as qv from 'query-validation';
import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';

import * as Utils from '../lib/utils/misc-utils';
import { EntityMap } from '../lib/utils/entity-utils';
import LocalParserClient from '../lib/prediction/localparserclient';
import * as I18n from '../lib/i18n';
import { Linker, AzureEntityLinker, Falcon } from '../lib/entity-linker';
import WikidataUtils from '../lib/entity-linker/wikidata';

interface Backend {
    schemas : ThingTalk.SchemaRetriever;
    i18n : I18n.LanguagePack;
    tokenizer : I18n.BaseTokenizer;
    nlu : LocalParserClient;
    nlg ?: LocalParserClient;
}

declare global {
    namespace Express {
        interface Application {
            backend : Backend;
            args : any;
        }
    }
}

function learn(req : express.Request, res : express.Response) {
    res.status(501).json({ error: 'Learning is not available with this Genie server' });
}

interface TokenizeData {
    q : string;
    entities ?: EntityMap;
    expect ?: string;
}

async function tokenize(params : Record<string, string>, data : TokenizeData, res : express.Response) {
    const app = res.app;
    if (params.locale !== app.args.locale) {
        res.status(404).json({ error: 'Unsupported language' });
        return;
    }

    const tokenized = await app.backend.tokenizer.tokenize(data.q);
    if (data.entities)
        Utils.renumberEntities(tokenized, data.entities);

    res.json(tokenized);
}

interface QueryNLUData {
    q : string;
    store ?: string;
    access_token ?: string;
    thingtalk_version ?: string;
    limit ?: string;
    expect ?: string;
    choices ?: string[];
    context ?: string;
    entities ?: EntityMap;
    tokenized ?: boolean;
    skip_typechecking ?: boolean;
    developer_key ?: string;
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

async function queryNLU(params : Record<string, string>,
                        data : QueryNLUData,
                        res : express.Response,
                        contextual : boolean) {
    const app = res.app;

    if (params.locale !== app.args.locale) {
        res.status(400).json({ error: 'Unsupported language' });
        return;
    }

    if (!contextual) {
        data.context = undefined;
        data.entities = undefined;
    }

    const result = await res.app.backend.nlu.sendUtterance(data.q,
        data.context ? data.context.split(' ') : undefined, data.entities, data);
    res.json(result);
}

interface QueryNLGData {
    context : string;
    entities : EntityMap;
    target : string;
    limit ?: string;
}
const NLG_PARAMS = {
    context: 'string',
    entities: 'object',
    target: 'string',
    limit: '?number',
};

async function queryNLG(params : Record<string, string>,
                        data : QueryNLGData,
                        res : express.Response,
                        contextual : boolean) {
    const app = res.app;

    if (params.locale !== app.args.locale) {
        res.status(400).json({ error: 'Unsupported language' });
        return;
    }

    const result = await res.app.backend.nlg!.generateUtterance(
        data.context.split(' '), data.entities, data.target.split(' '));
    res.json({
         candidates: result.slice(0, data.limit ? parseInt(data.limit) : undefined),
    });
}

export function initArgparse(subparsers : argparse.SubParser) {
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
    parser.add_argument('--contextual', {
        action: 'store_true',
        help: 'Contextual parser.',
        default: true
    });
    parser.add_argument('--no-contextual', {
        action: 'store_false',
        dest: 'contextual',
        help: 'Single turn parser.'
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
    parser.add_argument('--include-entity-value', {
        action: 'store_true',
        help: "Include entity value in thingtalk",
        default: false
    });
    parser.add_argument('--exclude-entity-display', {
        action: 'store_true',
        help: "Exclude entity display in thingtalk",
        default: false
    });
    parser.add_argument('--ned', {
        required: false,
        choices: ['azure', 'falcon']
    });
    parser.add_argument('--ner-cache', {
        required: false,
        help: `the path to the cache db, default to the module name if absent`
    });
    parser.add_argument('--wikidata-cache', {
        required: false,
        default: 'wikidata_cache.sqlite'
    });
    parser.add_argument('--bootleg', {
        required: false,
        default: 'bootleg.sqlite'
    });
}

export async function execute(args : any) {
    const tpClient = new Tp.FileClient(args);
    const schemas = new ThingTalk.SchemaRetriever(tpClient, null, true);
    const app = express();
    
    let entityLinker : Linker;
    if (args.ned) {
        const wikidata = new WikidataUtils(args.wikidata_cache, args.bootleg);
        if (args.ned === 'azure')
            entityLinker = new AzureEntityLinker(wikidata, args);
        else
            entityLinker = new Falcon(wikidata, args);
    }

    const i18n = I18n.get(args.locale);
    app.backend = {
        schemas,
        i18n,
        tokenizer: i18n.getTokenizer(),
        nlu: new LocalParserClient(args.nlu_model, args.locale, undefined, undefined, tpClient, {
            includeEntityValue: args.include_entity_value,
            excludeEntityDisplay: args.exclude_entity_display
        })
    };
    app.backend.nlu.start();
    if (args.nlg_model && args.nlg_model !== args.nlu_model) {
        app.backend.nlg = new LocalParserClient(args.nlg_model, args.locale, undefined, undefined, tpClient);
        app.backend.nlg.start();
    } else {
        app.backend.nlg = app.backend.nlu;
    }

    app.args = args;

    app.set('port', args.port);
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));
    //app.use(logger('dev'));

    app.use((req, res, next) => {
        res.set('Access-Control-Allow-Origin', '*');
        next();
    });

    app.post('/:locale/query', qv.validatePOST(QUERY_PARAMS, { accept: 'application/json' }), async (req, res, next) => {
        if (args.ned) {
            const entities = (await entityLinker.run((new Date()).toISOString(), req.body.q)).entities;
            const entityInfo = ['<e>'];
            for (const entity of entities) {
                entityInfo.push(entity.label);
                if (entity.domain)
                    entityInfo.push('(', entity.domain, ')');
                entityInfo.push('[', entity.id, ']', ';');
            }
            entityInfo.push('</e>');
            req.body.q = req.body.q + ' ' + entityInfo.join(' ');
        }
        queryNLU(req.params, req.body, res, args.contextual).catch(next);
    });

    app.post('/:locale/answer', qv.validatePOST(NLG_PARAMS, { accept: 'application/json' }), (req, res, next) => {
        queryNLG(req.params, req.body, res, args.contextual).catch(next);
    });

    app.post('/:locale/tokenize', qv.validatePOST({ q: 'string', entities: '?object' }, { accept: 'application/json' }), (req, res, next) => {
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
