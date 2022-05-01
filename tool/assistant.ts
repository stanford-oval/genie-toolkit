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
import * as readline from 'readline';
import * as Tp from 'thingpedia';

import Engine from '../lib/engine';
import Platform from './lib/cmdline-platform';

import Conversation from '../lib/dialogue-agent/conversation';
import { Message } from '../lib/dialogue-agent/protocol';
import { DEFAULT_THINGPEDIA_URL, DEFAULT_NLP_URL, getConfig } from './lib/argutils';

class CommandLineDelegate {
    private _rl : readline.Interface;

    constructor(rl : readline.Interface) {
        this._rl = rl;
    }

    destroy() {}

    async setHypothesis(hypothesis : string) {
        // go to beginning of line
        this._rl.write('', { ctrl: true, name: 'a' });
        // erase line
        this._rl.write('', { ctrl: true, name: 'k' });
        // write the new hypothesis
        this._rl.write(hypothesis);
    }
    async setExpected(expect : string) {
        console.log('>> expecting: ' + expect);
    }
    async addDevice(uniqueId : string, state : Tp.BaseDevice.DeviceState) {
        // nothing to do
    }

    async addMessage(msg : Message) {
        switch (msg.type) {
        case 'text':
            console.log('>> ' + msg.text);
            break;

        case 'picture':
            console.log('>> picture: ' + msg.url);
            break;

        case 'rdl':
            console.log('>> rdl: ' + msg.rdl.displayTitle + ' ' + (msg.rdl.callback || msg.rdl.webCallback));
            break;

        case 'choice':
            console.log('>> choice ' + msg.idx + ': ' + msg.title);
            break;

        case 'link':
            console.log('>> link: ' + msg.title + ' ' + msg.url);
            break;

        case 'button':
            console.log('>> button: ' + msg.title + ' ' + JSON.stringify(msg.json));
            break;
        }
    }
}

class CommandLineHandler {
    private _engine : Engine;
    private _conversation : Conversation;
    private _rl : readline.Interface;

    private _oauthKind : string|null;
    private _oauthSession : Record<string, string>;

    constructor(engine : Engine, conversation : Conversation, rl : readline.Interface) {
        this._engine = engine;
        this._conversation = conversation;

        this._rl = rl;
        this._rl.on('line', (line) => this._onLine(line));
        this._rl.on('SIGINT', () => this._quit());

        this._oauthKind = null;
        this._oauthSession = {};
    }

    private _quit() {
        console.log('Bye\n');
        this._engine.stop();
    }

    private _help() {
        console.log('Available commands:');
        console.log('\\q : quit');
        console.log('\\r <json-or-nn-tt> : send parsed command to Genie');
        console.log('\\y : answer yes');
        console.log('\\n : answer no');
        console.log('\\c <number> : make a choice');
        console.log('\\t <code> : send ThingTalk to Genie');
        console.log('\\a list : list apps');
        console.log('\\a stop [<uuid> | all] : stop app');
        console.log('\\d list : list devices');
        console.log('\\d create <json> : configure device manually');
        console.log('\\d start-oauth <kind> : start oauth');
        console.log('\\d complete-oauth <url> : finish oauth');
        console.log('\\d update <kind> : update devices');
        console.log('\\d delete <uuid> : delete device');
        console.log('\\= <pref> : show a preference value');
        console.log('\\= <pref> <value> : set a preference value');
        console.log('\\? or \\h : show this help');
        console.log('Any other command is interpreted as an English sentence and sent to Genie');
    }

    private _runAppCommand(cmd : string, param : string) {
        if (cmd === 'list') {
            this._engine.apps.getAllApps().forEach((app) => {
                console.log('- ' + app.uniqueId + ' ' + app.name + ': ' + app.description);
            });
        } else if (cmd === 'stop') {
            if (param === 'all') {
                for (const app of this._engine.apps.getAllApps())
                    this._engine.apps.removeApp(app);
            } else {
                const app = this._engine.apps.getApp(param);
                if (!app)
                    console.log('No app with ID ' + param);
                else
                    this._engine.apps.removeApp(app);
            }
        }
    }

    private _runPrefCommand(param : string, value : string) {
        const prefs = this._engine.platform.getSharedPreferences();
        if (value)
            console.log(prefs.set(param, JSON.parse(value)) ? "ok" : "failed to set");
        else
            console.log(prefs.get(param));
    }

    private async _runDeviceCommand(cmd : string, param : string) {
        if (cmd === 'list') {
            this._engine.getDeviceInfos().forEach((dev) => {
                console.log('- ' + dev.uniqueId + ' (' + dev.kind +') ' + dev.name + ': ' + dev.description);
            });
        } else if (cmd === 'start-oauth' || cmd === 'start-oauth2') {
            this._oauthKind = param;
            const [redirect, session] = await this._engine.startOAuth(param);
            this._oauthSession = session;
            console.log(redirect);
        } else if (cmd === 'complete-oauth' || cmd === 'complete-oauth2') {
            await this._engine.completeOAuth(this._oauthKind!, param, this._oauthSession);
        } else if (cmd === 'update' || cmd === 'upgrade') {
            await this._engine.upgradeDevice(param);
        } else if (cmd === 'create') {
            const parsed = JSON.parse(param);
            await this._engine.createDevice(parsed);
        } else if (cmd === 'delete') {
            await this._engine.deleteDevice(param);
        }
    }

    private _handleSlashR(line : string) {
        line = line.trim();
        if (line.startsWith('{'))
            return this._conversation.handleParsedCommand(JSON.parse(line));
        else
            return this._conversation.handleParsedCommand({ code: line.split(' '), entities: {} });
    }

    private _onLine(line : string) {
        Promise.resolve().then(async () => {
            if (line[0] === '\\') {
                if (line[1] === 'q')
                    await this._quit();
                else if (line[1] === '?' || line === 'h')
                    await this._help();
                else if (line[1] === 'r')
                    await this._handleSlashR(line.substr(3));
                else if (line[1] === 't')
                    await this._conversation.handleThingTalk(line.substr(3));
                else if (line[1] === 'c')
                    await this._conversation.handleParsedCommand({ code: ['bookkeeping', 'choice', line.substr(3)], entities: {} });
                else if (line[1] === 'y')
                    await this._conversation.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:yes'], entities: {} });
                else if (line[1] === 'n')
                    await this._conversation.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:no'], entities: {} });
                else if (line[1] === 'a')
                    await this._runAppCommand(...line.substr(3).split(' ') as [string, string]);
                else if (line[1] === 'd')
                    await this._runDeviceCommand(...line.substr(3).split(' ') as [string, string]);
                else if (line[1] === '=')
                    await this._runPrefCommand(...line.substr(3).split(' ') as [string, string]);
                else
                    console.log('Unknown command ' + line[1]);
            } else if (line.trim()) {
                await this._conversation.handleCommand(line);
            }
        }).then(() => {
            this._rl.prompt();
        });
    }
}

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('assistant', {
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
    parser.add_argument('--debug', {
        required: false,
        default: false,
        action: 'store_true',
        help: 'Enable additional debugging.'
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
    prefs.set('experimental-use-neural-nlg', !!args.nlg_server_url);
    const engine = new Engine(platform);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.setPrompt('$ ');

    await engine.open();
    const conversation = await engine.assistant.getOrOpenConversation('main', {
        nluServerUrl: args.nlu_server_url,
        nlgServerUrl: args.nlg_server_url,
        debug: args.debug,
        showWelcome: true
    });
    await conversation.addOutput(new CommandLineDelegate(rl));

    new CommandLineHandler(engine, conversation, rl);
    rl.prompt();

    await engine.run();

    rl.close();
    await engine.close();
}
