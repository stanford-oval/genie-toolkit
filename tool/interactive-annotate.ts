// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2021 The Board of Trustees of the Leland Stanford Junior University
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
import * as fs from 'fs';
import * as readline from 'readline';
import * as events from 'events';
import seedrandom from 'seedrandom';
import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';
import interpolate from 'string-interp';

import * as ThingTalkUtils from '../lib/utils/thingtalk';
import * as StreamUtils from '../lib/utils/stream-utils';
import { EntityMap } from '../lib/utils/entity-utils';
import { randint } from '../lib/utils/random';
import * as ParserClient from '../lib/prediction/parserclient';
import {
    DialogueSerializer,
    DialogueTurn,
} from '../lib/dataset-tools/parsers';
import AbstractDialogueAgent from '../lib/dialogue-agent/abstract_dialogue_agent';
import ExecutionDialogueAgent from '../lib/dialogue-agent/execution_dialogue_agent';
import DialoguePolicy from '../lib/dialogue-agent/dialogue_policy';
import ValueCategory from '../lib/dialogue-agent/value-category';
import Engine from '../lib/engine';

import MultiJSONDatabase from './lib/multi_json_database';
import Platform from './lib/cmdline-platform';

interface AnnotatorOptions {
    locale : string;
    timezone : string|undefined;
    thingpedia_url : string;
    thingpedia_dir : string|undefined;
    nlu_server : string;
    database_file : string|undefined;
    execution_mode : 'simulation'|'real';
    random_seed : string;
}

class Annotator extends events.EventEmitter {
    private _rl : readline.Interface;
    private _locale : string;
    private _rng : () => number;
    private _platform : Tp.BasePlatform;
    private _tpClient : Tp.BaseClient;
    private _schemas : ThingTalk.SchemaRetriever;
    private _parser : ParserClient.ParserClient;
    private _executor : AbstractDialogueAgent<unknown>;
    private _dialoguePolicy : DialoguePolicy;
    private _engine : Engine|undefined;
    private _simulatorDatabase : MultiJSONDatabase|undefined;

    private _state : 'loading'|'input'|'done'|'top3'|'full'|'code';
    private _serial : number;
    private _outputDialogue : DialogueTurn[];
    private _currentTurnIdx : number;
    private _outputTurn : DialogueTurn;
    private _context : ThingTalk.Ast.DialogueState|null;
    private _executorState : any|undefined;
    private _preprocessed : string|undefined;
    private _entities : EntityMap|undefined;
    private _candidates : ThingTalk.Ast.DialogueState[]|undefined;

    constructor(rl : readline.Interface, options : AnnotatorOptions) {
        super();

        this._rl = rl;

        this._locale = options.locale;
        this._rng = seedrandom.alea(options.random_seed);
        this._parser = ParserClient.get(options.nlu_server, options.locale);

        this._platform = new Platform(undefined, options.locale, options.thingpedia_url);
        this._tpClient = this._platform.getCapability('thingpedia-client')!;

        if (options.execution_mode === 'simulation') {
            this._schemas = new ThingTalk.SchemaRetriever(this._tpClient, null, true);

            const simulatorOptions : ThingTalkUtils.SimulatorOptions = {
                rng: seedrandom.alea('almond is awesome'),
                locale: options.locale,
                timezone: options.timezone,
                thingpediaClient: this._tpClient,
                schemaRetriever: this._schemas,
                interactive: true
            };
            if (options.database_file) {
                this._simulatorDatabase = new MultiJSONDatabase(options.database_file);
                simulatorOptions.database = this._simulatorDatabase;
            }

            this._executor = ThingTalkUtils.createSimulator(simulatorOptions);
        } else {
            this._engine = new Engine(this._platform);
            this._executor = new ExecutionDialogueAgent(this._engine, this, false);
            this._schemas = this._engine.schemas;
        }
        this._dialoguePolicy = new DialoguePolicy({
            thingpedia: this._tpClient,
            schemas: this._schemas,
            locale: this._locale,
            timezone: options.timezone,
            rng: this._rng,
            debug: false
        });

        this._state = 'loading';

        this._serial = 0;

        this._outputDialogue = [];
        this._currentTurnIdx = 0;
        this._outputTurn = {
            context: 'null',
            agent: '',
            agent_target: '',
            intermediate_context: '',
            user: '',
            user_target: '',
        };
        this._context = null;
        this._executorState = undefined;
        this._preprocessed = undefined;
        this._entities = {};
        this._candidates = undefined;

        rl.on('line', async (line) => {
            if (this._state === 'done')
                return;

            line = line.trim();

            if (line.length === 0 || this._state === 'loading') {
                rl.prompt();
                return;
            }

            if (line === 'h' || line === '?') {
                this._help();
                return;
            }
            if (line === 'q') {
                this._quit();
                return;
            }

            if (line === 'd') {
                this.next();
                return;
            }

            if (this._state === 'input') {
                this._handleUtterance(line).catch((e) => this.emit('error', e));
                return;
            }

            if (this._state === 'code') {
                this._learnThingTalk(line).catch((e) => this.emit('error', e));
                return;
            }

            if (Number.isFinite(parseInt(line))) {
                this._learnNumber(parseInt(line));
            } else if (line === 'n') {
                this._more();
            } else if (line === 'e') {
                this._edit(undefined);
            } else if (line.startsWith('e ')) {
                this._edit(parseInt(line.substring(2).trim()));
            } else if (line === 't') {
                this._state = 'code';
                rl.setPrompt('TT: ');
                rl.prompt();
            } else {
                //console.log('Invalid command');
                //rl.prompt();
                this._learnThingTalk(line).catch((e) => this.emit('error', e));
            }
        });
    }

    // implementation of the abstract dialogue loop interface, which the
    // execution dialogue agent calls sometimes

    get _() {
        return (x : string) => x;
    }
    get icon() {
        return null;
    }
    set icon(v : string|null) {
        // do nothing
    }
    get isAnonymous() {
        return false;
    }
    get platformData() {
        return {};
    }

    interpolate(msg : string, args : Record<string, unknown>) : string {
        return interpolate(msg, args, {
            locale: this._locale,
            timezone: this._platform.timezone
        })||'';
    }

    async reply(msg : string) {
        console.log('A: ' + msg);
    }
    async replyLink(title : string, link : string) {
        console.log('A: ' + title + ' ' + link);
    }

    async replyInterp(msg : string, args ?: Record<string, unknown>) {
        if (args === undefined)
            return this.reply(msg);
        else
            return this.reply(this.interpolate(msg, args));
    }

    async ask(cat : ValueCategory, question : string) : Promise<ThingTalk.Ast.Value> {
        if (cat === ValueCategory.Location)
            return new ThingTalk.Ast.LocationValue(new ThingTalk.Ast.AbsoluteLocation(37.4299908, -122.175519, "Gates Computer Science"));
        if (cat === ValueCategory.Time)
            return new ThingTalk.Ast.TimeValue(new ThingTalk.Ast.AbsoluteTime(randint(9, 12, this._rng), 0, 0));

        throw new TypeError(`Unexpected question of type ${cat}`);
    }
    async askChoices(question : string, choices : string[]) : Promise<number> {
        return randint(0, choices.length-1, this._rng);
    }

    private _quit() {
        if (this._outputTurn.user_target)
            this._outputDialogue.push(this._outputTurn);
        if (this._outputDialogue.length > 0) {
            this.emit('learned', {
                id: String(this._serial),
                turns: this._outputDialogue,
            });
        }

        this.emit('quit');
    }

    private _help() {
        console.log('Available commands:');
        console.log('q: quit');
        console.log('d: (done) complete the current dialog and start the next one');
        console.log('<0-9>: make a choice');
        console.log('n: (next) show more choices');
        console.log('e <0-9>: edit a choice');
        console.log('t: (thingtalk) write code directly');
        console.log('? or h: this help');
    }

    async start() {
        if (this._simulatorDatabase)
            await this._simulatorDatabase.load();
        if (this._engine)
            await this._engine.open();
        await this._parser.start();
    }
    async stop() {
        await this._parser.stop();
        if (this._engine)
            await this._engine.stop();
    }

    private async _learnThingTalk(code : string) {
        let newState;
        try {
            const program = await ThingTalkUtils.parse(code, this._schemas);
            newState = await this._inputToDialogueState(program);
            if (!newState) {
                console.log(`Not a valid dialogue state`);
                this._rl.setPrompt('TT: ');
                this._rl.prompt();
                return;
            }

            // check that the entities are correct by serializing the program once
            ThingTalkUtils.serializePrediction(newState, this._preprocessed!, this._entities!, {
                locale: this._locale
            }).join(' ');
        } catch(e) {
            console.log(`${e.name}: ${e.message}`);
            this._rl.setPrompt('TT: ');
            this._rl.prompt();
            return;
        }

        const oldContext = this._context;
        this._context = ThingTalkUtils.computeNewState(this._context, newState, 'user');
        const prediction = ThingTalkUtils.computePrediction(oldContext, this._context, 'user');
        this._outputTurn.user_target = prediction.prettyprint();
        this._nextTurn();
    }

    private _edit(i : number|undefined) {
        let program;
        if (i === undefined) {
            program = this._context!;
        } else {
            if (Number.isNaN(i) || i < 1 || i > this._candidates!.length) {
                console.log('Invalid number');
                this._rl.setPrompt('$ ');
                this._rl.prompt();
                return;
            }
            i -= 1;
            program = this._candidates![i];
        }
        this._state = 'code';
        this._rl.setPrompt('TT: ');
        this._rl.write(program.prettyprint().replace(/\n/g, ' '));
        this._rl.prompt();
    }

    private _learnNumber(i : number) {
        if (i < 1 || i > this._candidates!.length) {
            console.log('Invalid number');
            this._rl.setPrompt('$ ');
            this._rl.prompt();
            return;
        }
        i -= 1;

        const program = this._candidates![i];
        const oldContext = this._context;
        this._context = ThingTalkUtils.computeNewState(this._context, program, 'user');
        const prediction = ThingTalkUtils.computePrediction(oldContext, this._context, 'user');
        this._outputTurn.user_target = prediction.prettyprint();
        this._nextTurn();
    }

    private _more() {
        if (this._state === 'top3') {
            this._state = 'full';
            const candidates = this._candidates!;
            for (let i = 0; i < candidates.length; i++)
                console.log(`${i+1}) ${candidates[i].prettyprint()}`);
            this._rl.setPrompt('$ ');
            this._rl.prompt();
        } else {
            this._state = 'code';
            this._rl.setPrompt('TT: ');
            this._rl.prompt();
        }
    }

    next() {
        if (this._outputTurn.user_target)
            this._outputDialogue.push(this._outputTurn);
        if (this._outputDialogue.length > 0) {
            this.emit('learned', {
                id: String(this._serial),
                turns: this._outputDialogue,
            });
        }

        this._serial++;
        console.log(`Dialog #${this._serial}`);

        this._outputDialogue = [];
        this._context = null;
        this._executorState = undefined;
        this._currentTurnIdx = -1;

        this._nextTurn();
    }

    private async _nextTurn() {
        if (this._outputTurn.user_target)
            this._outputDialogue.push(this._outputTurn);
        this._currentTurnIdx ++;

        this._outputTurn = {
            context: 'null',
            agent: '',
            agent_target: '',
            intermediate_context: '',
            user: '',
            user_target: '',
        };

        if (this._currentTurnIdx > 0) {
            try {
                const { newDialogueState, newExecutorState } = await this._executor.execute(this._context!, this._executorState);
                this._context = newDialogueState;
                this._executorState = newExecutorState;
            } catch(e) {
                if (e.code === 'ECANCELLED') {
                    this.next();
                    return;
                } else {
                    throw e;
                }
            }

            console.log();
            const contextCode = this._context.prettyprint();
            for (const line of contextCode.trim().split('\n'))
                console.log('C: ' + line);
            this._outputTurn.context = contextCode;

            // run the agent

            const policyResult = await this._dialoguePolicy.chooseAction(this._context);
            if (!policyResult) {
                console.log('Dialogue policy error: no reply at this state');
                this.next();
                return;
            }
            const [dialogueStateAfterAgent, , utterance] = policyResult;
            console.log('A: ' + utterance);

            const prediction = ThingTalkUtils.computePrediction(this._context, dialogueStateAfterAgent, 'agent');

            this._outputTurn.agent = utterance;
            this._outputTurn.agent_target = prediction.prettyprint();
            this._context = dialogueStateAfterAgent;
        }

        this._state = 'input';

        this._rl.setPrompt('U: ');
        this._rl.prompt();
    }

    private async _inputToDialogueState(input : ThingTalk.Ast.Input) : Promise<ThingTalk.Ast.DialogueState|null> {
        return ThingTalkUtils.inputToDialogueState(this._dialoguePolicy, this._context, input);
    }

    private async _handleUtterance(utterance : string) {
        this._outputTurn.user = utterance;
        this._state = 'loading';

        let contextCode, contextEntities;
        if (this._context !== null) {
            const context = ThingTalkUtils.prepareContextForPrediction(this._context, 'user');
            [contextCode, contextEntities] = ThingTalkUtils.serializeNormalized(context);
        } else {
            contextCode = ['null'];
            contextEntities = {};
        }

        const parsed = await this._parser.sendUtterance(utterance, contextCode, contextEntities, {
            tokenized: false,
            skip_typechecking: true
        });

        this._state = 'top3';
        this._preprocessed = parsed.tokens.join(' ');
        this._entities = parsed.entities;
        const candidates = await ThingTalkUtils.parseAllPredictions(parsed.candidates, parsed.entities, {
            thingpediaClient: this._tpClient,
            schemaRetriever: this._schemas,
            loadMetadata: true
        }) as ThingTalk.Ast.DialogueState[];
        this._candidates = (await Promise.all(candidates.map((c) => this._inputToDialogueState(c)))).filter((c) : c is ThingTalk.Ast.DialogueState => c !== null);

        if (this._candidates.length > 0) {
            for (let i = 0; i < 3 && i < this._candidates.length; i++)
                console.log(`${i+1}) ${this._candidates[i].prettyprint()}`);
        } else {
            console.log(`No candidates for this command`);
        }

        this._rl.setPrompt('$ ');
        this._rl.prompt();
    }
}

const THINGPEDIA_URL = 'https://almond-dev.stanford.edu/thingpedia';
const NL_SERVER_URL = 'https://nlp-staging.almond.stanford.edu';

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('interactive-annotate', {
        add_help: true,
        description: `Interactively annotate a dialog dataset, by annotating each user sentence and running the real agent.`
    });
    parser.add_argument('-o', '--output', {
        required: true,
    });
    parser.add_argument('-l', '--locale', {
        required: false,
        default: 'en-US',
        help: `BGP 47 locale tag of the natural language being processed (defaults to en-US).`
    });
    parser.add_argument('--timezone', {
        required: false,
        default: undefined,
        help: `Timezone to use to print dates and times (defaults to the current timezone).`
    });
    parser.add_argument('--thingpedia-url', {
        required: false,
        default: THINGPEDIA_URL,
        help: 'URL of Thingpedia to use, or local path pointing to a thingpedia.tt file.'
    });
    parser.add_argument('--thingpedia-dir', {
        required: false,
        nargs: '+',
        help: 'Path to a directory containing Thingpedia device definitions (overrides --thingpedia-url).'
    });
    parser.add_argument('--database-file', {
        required: false,
        help: `Path to a file pointing to JSON databases used to simulate queries.`,
    });
    parser.add_argument('--nlu-server', {
        required: false,
        default: NL_SERVER_URL,
        help: `The URL of the natural language server to parse user utterances. Use a file:// URL pointing to a model directory to use a local instance of genienlp.`
    });
    parser.add_argument('--execution-mode', {
        required: false,
        default: 'real',
        choices: ['simulation', 'real'],
        help: `Whether to simulate API calls or execute them for real.`
    });
    parser.add_argument('--append', {
        action: 'store_true',
        help: 'Append to the output file instead of overwriting',
        default: false,
    });
    parser.add_argument('--no-append', {
        action: 'store_false',
        dest: 'append',
        help: 'Overwrite the output file instead of appending',
    });
}

export async function execute(args : any) {
    const learned = new DialogueSerializer({ annotations: true });
    const output = fs.createWriteStream(args.output, { flags: (args.append ? 'a' : 'w') });
    learned.pipe(output);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.setPrompt('$ ');

    function quit() {
        learned.end();
        rl.close();
        //process.exit();
    }

    const annotator = new Annotator(rl, args);
    await annotator.start();

    annotator.on('end', quit);
    annotator.on('learned', (dlg) => {
        learned.write(dlg);
    });
    annotator.on('quit', quit);
    rl.on('SIGINT', quit);
    annotator.next();
    //process.stdin.on('end', quit);

    await StreamUtils.waitFinish(output);
    await annotator.stop();
}
