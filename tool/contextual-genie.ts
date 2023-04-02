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
import * as Tp from 'thingpedia';
import * as log4js from "log4js";

import Engine from '../lib/engine';
import Platform from './lib/cmdline-platform';

import Conversation from '../lib/dialogue-agent/conversation';
import { Message } from '../lib/dialogue-agent/protocol';
import { DEFAULT_NLP_URL, getConfig } from './lib/argutils';

import express from 'express';
import { purgeDB } from './assistant';
import { AddressInfo } from 'net';

import * as qv from 'query-validation';

import { Logger, getLogger } from 'log4js';
import bodyParser from 'body-parser';
import { parse } from '../lib/utils/thingtalk';
import { Ast } from 'thingtalk';

import { Mutex } from 'async-mutex';


export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('contextual-genie', {
        add_help: true,
        description: "Test/demo the assistant interactively."
    });
    parser.add_argument('--workdir', {
        required: false,
        help: 'Directory where to store the assistant database and other files (defaults to the ~/.config/genie-toolkit).'
    });
    parser.add_argument('-l', '--locale', {
        required: false,
        default: 'en-US',
        help: `BGP 47 locale tag of the language to use for the assistant (defaults to 'en-US', English)`
    });
    parser.add_argument('--thingpedia-url', {
        required: false,
        help: 'URL of Thingpedia to use.'
    });
    parser.add_argument('--thingpedia-dir', {
        required: false,
        nargs: '+',
        help: 'Path to a directory containing Thingpedia device definitions (overrides --thingpedia-url).'
    });
    parser.add_argument('--nlu-server-url', {
        required: false,
        help: 'NLP server URL to use for NLU (can be a file:/// URL).'
    });
    parser.add_argument('--nlg-server-url', {
        required: false,
        help: 'NLP server URL to use for NLG; must be specified to use neural NLG.'
    });
    parser.add_argument('--default-agent', {
        required: false,
        help: 'Defatult GenieScript assistant agent to be used.'
    });
    parser.add_argument('--mixed-initiative', {
        required: false,
        default: true,
        action: 'store_true',
        help: 'Enable GenieScript assistant agent.'
    });
    parser.add_argument('--clean-start', {
        required: false,
        default: true,
        action: 'store_true',
        help: 'Starts GenieScript with a clean dialogue state'
    });
    parser.add_argument('--use-dynamic', {
        required: false,
        default: true,
        action: 'store_true',
        help: 'Enables GenieScript to dynamically apply sentence state statements, default to true'
    });
    parser.add_argument('--debug', {
        required: false,
        default: false,
        action: 'store_true',
        help: 'Enable additional debugging.'
    });
    parser.add_argument('--log-file-name', {
        required: false,
        default: Date.now().toFixed() + ".log",
        help: "Direct all logging to this file, typically under ~/.cache/genie-toolkit"
    });
    parser.add_argument('--server-address', {
        required: false,
        default: 0,
        help: "Where to initialize the server, default to a random port"
    });
}


class serverController {
    private _engine : Engine;
    private _conversation : Conversation;
    
    message : string[];
    portNumber : AddressInfo | string | null;
    app;
    server;

    logger : Logger;

    constructor(engine : Engine, conversation : Conversation, port : number) {
        this.logger = getLogger("serverController");
        this.logger.level = "debug";

        this.app = express();
        this.app.use(bodyParser.json());
        this.server = this.app.listen(port);
        this.portNumber = this.server.address();

        if (this.portNumber && !(typeof this.portNumber === 'string')) {
            this.logger.info(`Server port number at: ${this.portNumber.address}, ${this.portNumber.family}, ${this.portNumber.port}`);
            console.log(`Server port number at: ${this.portNumber.address}, ${this.portNumber.family}, ${this.portNumber.port}`);
        } else {
            this.logger.info(`Server port number at: ${this.portNumber}`);
            console.log(`Server port number at: ${this.portNumber}`);
        }

        this._engine = engine;
        this._conversation = conversation;

        this.message = [];

        // we use a mutex to guard query and queryContext, so as to not possibly cross-contaminate
        const mutex = new Mutex();

        // main entry point for python method .query() for submitting queries to Genie
        this.app.get('/query', qv.validateGET({ q : 'string' }), async (req, res) => {
            const release = await mutex.acquire();
            
            try {
                const query = req.query.q;
                if (typeof query === 'string')
                    await this.handleNormalInput(query);
            } finally {
                release();
            }
            
            if (this.message.length === 0)
                this.message.push("Sorry, I had an error processing your command");

            
            res.send({
                "response": this.message,
                "results": this._conversation._loop.ttReply ? this._conversation._loop.ttReply.result_values : [],
                "user_target": this._conversation._loop.ttReply ? this._conversation._loop.ttReply.user_target : "",
                "ds": this._conversation._loop._thingtalkHandler._dialogueState ? this._conversation._loop._thingtalkHandler._dialogueState.prettyprint() : "null"
            });
        });

        // main entry point for python method .query_context()
        // for submitting queries to Genie *with* context
        // NOTE: currently, there is a bug in this method: In first invocation it would not work.
        // Instead, one must first call this method without ds parameter to "initialize" it
        this.app.post('/queryContext', qv.validatePOST({ q : 'string', ds : '?string' }), async (req, res) => {
            const release = await mutex.acquire();
            
            try {
                const query = req.body.q;
                const ds = req.body.ds;

                if (ds && typeof ds === 'string' && ds !== 'null') {
                    const parsedDS = await parse(ds, this._engine.schemas);
                    if (parsedDS instanceof Ast.DialogueState) {
                        this._conversation._loop._thingtalkHandler._dialogueState = parsedDS;
                        this._conversation._loop._thingtalkHandler._dialogueState.updateCurrent();
                    }
                } else if (ds === 'null') {
                    this._conversation._loop._thingtalkHandler._dialogueState = null;
                }
                if (typeof query === 'string') {
                    this.message = [];
                    await this._conversation._loop.handleSingleCommand(query);
                }
            } finally {
                release();
            }
            
            if (this.message.length === 0)
                this.message.push("Sorry, I had an error processing your command");
            
            res.send({
                "response": this.message,
                "results": this._conversation._loop.ttReply ? this._conversation._loop.ttReply.result_values : [],
                "user_target": this._conversation._loop.ttReply ? this._conversation._loop.ttReply.user_target : "",
                "ds": this._conversation._loop._thingtalkHandler._dialogueState ? this._conversation._loop._thingtalkHandler._dialogueState.prettyprint() : "null"
            });
        });

        // main entry point for python method .quit() for submitting queries to Genie
        this.app.post('/quit', async (req, res) => {
            try {
                await this._engine.close();
                res.send({ "response": 200 });
            } catch{
                res.send({ "response": 404 });
            }
        });

        // main entry point for python method .clean() for submitting queries to Genie
        this.app.post('/clean', async (req, res) => {
            try {
                const state = this._conversation.getState();
                const deviceIds = this._engine.getDeviceInfos().map((dev) => dev.uniqueId);
                for (const id of deviceIds) {
                    if (id.includes('builtin') || id.includes('thingengine'))
                        continue;
                    else
                        await this._engine.upgradeDevice(id, true);
                }
                await this._conversation.restart(state, true);
                res.send({ "response": 200 });
            } catch{
                res.send({ "response": 404 });
            }
        });

        // main entry point for python method .set_num_results() for setting number of results
        this.app.post('/setNumResults', qv.validatePOST({ numResults: 'integer' }, { accept: 'application/json' }), async (req, res) => {
            try {
                const numResults : number = +req.body.numResults;
                this._conversation._loop._thingtalkHandler.numResults = numResults;
                res.send({ "response": 200 });
            } catch{
                res.send({ "response": 404 });
            }
        });
    }

    destroy() {}

    async setHypothesis(hypothesis : string) {
    }
    async setExpected(expect : string) {
    }
    async addDevice(uniqueId : string, state : Tp.BaseDevice.DeviceState) {
    }
    async addMessage(msg : Message) {
        if (msg.type === 'text')
            this.message.push(msg.text);
    }

    async handleNormalInput(msg : string) {
        // every time we first get rid of all previous msgs
        this.message = [];
        await this._conversation.handleCommand(msg);
    }
}


// initialization
export async function execute(args : any) {
    if (!args.nlu_server_url)
        args.nlu_server_url = await getConfig('thingpedia.nlp-url', DEFAULT_NLP_URL);
    
    const platform = new Platform(args.workdir, args.locale, args.thingpedia_url);
    const logPath : string = platform.cacheDir + '/' + args.log_file_name;
    console.log(`Log file available at ${logPath}`);

    // configure all loggers
    log4js.configure({
        appenders: {
          everything: { type: "file", filename: logPath },
        },
        categories: {
          default: { appenders: ["everything"], level: "debug" },
        },
    });

    const prefs = platform.getSharedPreferences();
    if (args.thingpedia_dir && args.thingpedia_dir.length)
        prefs.set('developer-dir', args.thingpedia_dir);
    if (args.mixed_initiative)
        prefs.set('mixed-initiative', args.mixed_initiative);
    if (args.default_agent)
        prefs.set('default-agent', args.default_agent);
    else
        // reset to false if default agent is not set
        prefs.set('mixed-initiative', false);
    prefs.set('experimental-use-neural-nlg', !!args.nlg_server_url);

    if (args.clean_start)
        purgeDB(platform);

    const engine = new Engine(platform);

    await engine.open();
    const conversation = await engine.assistant.getOrOpenConversation('main', {
        nluServerUrl: args.nlu_server_url,
        nlgServerUrl: args.nlg_server_url,
        debug: args.debug,
        cleanStart: args.clean_start,
        ifDynamic: args.use_dynamic,
        showWelcome: false
    });

    const exposurer = new serverController(engine, conversation, +args.server_address);
    await conversation.addOutput(exposurer);

    await engine.run();
}