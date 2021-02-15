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


import * as readline from 'readline';

import Engine from '../lib/engine';
import Platform from './lib/cmdline-platform';

const THINGPEDIA_URL = 'https://almond-dev.stanford.edu/thingpedia';
const NL_SERVER_URL = 'https://nlp-staging.almond.stanford.edu';

class LocalUser {
    constructor() {
        this.id = process.getuid();
        this.account = 'local:'+this.id;
        this.name = 'Local User';
    }
}

class CommandLineDelegate {
    constructor(rl) {
        this._rl = rl;
    }

    setHypothesis(hypothesis) {
        // go to beginning of line
        this._rl.write('', { ctrl: true, name: 'a' });
        // erase line
        this._rl.write('', { ctrl: true, name: 'k' });
        // write the new hypothesis
        this._rl.write(hypothesis);
    }
    setExpected(expect) {
        console.log('>> expecting: ' + expect);
    }

    addMessage(msg) {
        switch (msg.type) {
        case 'text':
        case 'result':
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
    constructor(engine, conversation, rl) {
        this._engine = engine;
        this._conversation = conversation;

        this._rl = rl;
        this._rl.on('line', (line) => this._onLine(line));
        this._rl.on('SIGINT', () => this._quit());

        this._oauthKind = null;
        this._oauthSession = {};
    }

    _quit() {
        console.log('Bye\n');
        this._engine.stop();
    }

    _help() {
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
        console.log('\\d start-oauth <kind> : start oauth');
        console.log('\\d complete-oauth <url> : finish oauth');
        console.log('\\d update <kind> : update devices');
        console.log('\\= <pref> : show a preference value');
        console.log('\\= <pref> <value> : set a preference value');
        console.log('\\? or \\h : show this help');
        console.log('Any other command is interpreted as an English sentence and sent to Genie');
    }

    _runAppCommand(cmd, param) {
        if (cmd === 'list') {
            this._engine.apps.getAllApps().forEach((app) => {
                console.log('- ' + app.uniqueId + ' ' + app.name + ': ' + app.description);
            });
        } else if (cmd === 'stop') {
            if (param === 'all') {
                for (let app of this._engine.apps.getAllApps())
                    this._engine.apps.removeApp(app);
            } else {
                let app = this._engine.apps.getApp(param);
                if (!app)
                    console.log('No app with ID ' + param);
                else
                    this._engine.apps.removeApp(app);
            }
        }
    }

    _runPrefCommand(param, value) {
        const prefs = this._engine.platform.getSharedPreferences();
        if (value)
            console.log(prefs.set(param, JSON.parse(value)) ? "ok" : "failed to set");
        else
            console.log(prefs.get(param));
    }

    _runDeviceCommand(cmd, param) {
        if (cmd === 'list') {
            this._engine.devices.getAllDevices().forEach((dev) => {
                console.log('- ' + dev.uniqueId + ' (' + dev.kind +') ' + dev.name + ': ' + dev.description);
            });
        } else if (cmd === 'start-oauth' || cmd === 'start-oauth2') {
            this._oauthKind = param;
            return this._engine.devices.addFromOAuth(param).then(([redirect, session]) => {
                this._oauthSession = session;
                console.log(redirect);
            });
        } else if (cmd === 'complete-oauth' || cmd === 'complete-oauth2') {
            return this._engine.devices.completeOAuth(this._oauthKind, param, this._oauthSession);
        } else if (cmd === 'update' || cmd === 'upgrade') {
            return this._engine.devices.updateDevicesOfKind(param);
        }

        return Promise.resolve();
    }

    _handleSlashR(line) {
        line = line.trim();
        if (line.startsWith('{'))
            return this._conversation.handleParsedCommand(JSON.parse(line));
        else
            return this._conversation.handleParsedCommand({ code: line.split(' '), entities: {} });
    }

    _onLine(line) {
        Promise.resolve().then(() => {
            if (line[0] === '\\') {
                if (line[1] === 'q')
                    return this._quit();
                else if (line[1] === '?' || line === 'h')
                    return this._help();
                else if (line[1] === 'r')
                    return this._handleSlashR(line.substr(3));
                else if (line[1] === 't')
                    return this._conversation.handleThingTalk(line.substr(3));
                else if (line[1] === 'c')
                    return this._conversation.handleParsedCommand({ code: ['bookkeeping', 'choice', line.substr(3)], entities: {} });
                else if (line[1] === 'y')
                    return this._conversation.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:yes'], entities: {} });
                else if (line[1] === 'n')
                    return this._conversation.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:no'], entities: {} });
                else if (line[1] === 'a')
                    return this._runAppCommand(...line.substr(3).split(' '));
                else if (line[1] === 'd')
                    return this._runDeviceCommand(...line.substr(3).split(' '));
                else if (line[1] === '=')
                    return this._runPrefCommand(...line.substr(3).split(' '));
                else
                    console.log('Unknown command ' + line[1]);
            } else if (line.trim()) {
                return this._conversation.handleCommand(line);
            }

            // quiet warning
            return Promise.resolve();
        }).then(() => {
            this._rl.prompt();
        });
    }
}

export function initArgparse(subparsers) {
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
        default: THINGPEDIA_URL,
        help: 'URL of Thingpedia to use.'
    });
    parser.add_argument('--thingpedia-dir', {
        required: false,
        nargs: '+',
        help: 'Path to a directory containing Thingpedia device definitions (overrides --thingpedia-url).'
    });
    parser.add_argument('--nlu-server', {
        required: false,
        default: NL_SERVER_URL,
        help: 'NLP server URL to use for NLU (can be a file:/// URL).'
    });
    parser.add_argument('--nlg-server', {
        required: false,
        help: 'NLP server URL to use for NLG; must be specified to use neural NLG.'
    });
}

export async function execute(args) {
    const platform = new Platform(args.workdir, args.locale, args.thingpediaUrl);
    const prefs = platform.getSharedPreferences();
    if (args.thingpedia_dir && args.thingpedia_dir.length)
        prefs.set('developer-dir', args.thingpedia_dir);
    prefs.set('experimental-use-neural-nlg', !!args.nlg_server);
    const engine = new Engine(platform);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.setPrompt('$ ');

    await engine.open();
    const conversation = await engine.assistant.openConversation('main', new LocalUser(), {
        nluServerUrl: args.nlu_server,
        nlgServerUrl: args.nlg_server,
        debug: false,
        showWelcome: true
    });
    await conversation.addOutput(new CommandLineDelegate(rl));

    new CommandLineHandler(engine, conversation, rl);
    await conversation.start();
    rl.prompt();

    await engine.run();

    rl.close();
    await engine.close();
}
