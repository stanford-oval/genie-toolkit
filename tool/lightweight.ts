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
// import * as readline from 'readline';
import * as Tp from 'thingpedia';
import * as fs from 'fs';
import express from 'express';

import Engine from '../lib/engine';
import Platform from './lib/cmdline-platform';
import * as qv from 'query-validation';

// import Conversation from '../lib/dialogue-agent/conversation';
import { Message } from '../lib/dialogue-agent/protocol';
import { DEFAULT_THINGPEDIA_URL, DEFAULT_NLP_URL, getConfig } from './lib/argutils';
import bodyParser from 'body-parser';

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

class LightWeightExposurer {
    message : string[];

    constructor() {
        this.message = [];
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
        else
            console.log("message type not text");
    }
}

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('lightweight', {
        add_help: true,
        description: "Expose a lightweight assistant over http ports"
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
        default: false,
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
}

function purgeDB(platform : Platform) {
    console.log('Clean-start initiated');
    const dir = platform.getWritableDir();
    const regex = /sqlite.db.*/i;
    fs.readdirSync(dir)
        .filter((f) => regex.test(f))
        .forEach((f) => {
            fs.unlinkSync(dir + '/' + f);
            console.log(`${dir + '/' + f} deleted`);
        });
}


export async function execute(args : any) {
    if (!args.thingpedia_url)
        args.thingpedia_url = await getConfig('thingpedia.url', process.env.THINGPEDIA_URL || DEFAULT_THINGPEDIA_URL);
    if (!args.nlu_server_url)
        args.nlu_server_url = await getConfig('thingpedia.nlp-url', DEFAULT_NLP_URL);

    const platform = new Platform(args.workdir, args.locale, args.thingpedia_url);
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

    // creating a port
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

    const app = express();
    app.set('port', 8405);
    app.use(bodyParser.json());

    const exposurer = new LightWeightExposurer();
    await conversation.addOutput(exposurer);

    app.post('/query', qv.validatePOST(QUERY_PARAMS, { accept: 'application/json' }), async (req, res) => {
        // every time we first get rid of all previous msgs
        exposurer.message = [];

        // we also get rid of all contexts
        const state = conversation.getState();
        await conversation.restart(state, true);

        await conversation.handleCommand(req.body.q);
        res.send({
           "genie_response": exposurer.message,
           "reviews": [],
        });
    });

    app.listen(8405, () => {
        console.log("Server listening on PORT", 8405);
    }); 

    await engine.run();

    await engine.close();
}
