// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
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

import assert from 'assert';
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
import AbstractDialogueAgent from '../lib/dialogue-agent/abstract_dialogue_agent';
import ExecutionDialogueAgent from '../lib/dialogue-agent/execution_dialogue_agent';
import Engine from '../lib/engine';
import ValueCategory from '../lib/dialogue-agent/value-category';
import {
    DialogueParser,
    DialogueSerializer,
    ParsedDialogue,
    DialogueTurn,
} from '../lib/dataset-tools/parsers';

import { readAllLines } from './lib/argutils';
import MultiJSONDatabase from './lib/multi_json_database';
import Platform from './lib/cmdline-platform';
import { THINGPEDIA_URL, NLP_SERVER_URL } from '../lib/config';

interface AnnotatorOptions {
    locale : string;
    timezone : string;
    thingpedia_url : string;
    thingpedia_dir : string[]|undefined;
    user_nlu_server : string;
    agent_nlu_server : string;
    database_file : string|undefined;
    execution_mode : 'simulation'|'real';
    target_language : string;

    existing_annotations : boolean;
    edit_mode : boolean;
    only_ids : string|undefined;
    max_turns : number|undefined;
    offset : number;
}

class Annotator extends events.EventEmitter {
    private _rl : readline.Interface;
    private _nextDialogue : Iterator<ParsedDialogue>;
    private _hasExistingAnnotations : boolean;
    private _editMode : boolean;
    private _onlyIds : Set<string>|undefined;
    private _maxTurns : number|undefined;
    private _locale : string;
    private _timezone : string;
    private _rng : () => number;
    private _platform : Tp.BasePlatform;
    private _tpClient : Tp.BaseClient;
    private _schemas : ThingTalk.SchemaRetriever;
    private _userParser : ParserClient.ParserClient;
    private _agentParser : ParserClient.ParserClient;
    private _executor : AbstractDialogueAgent<unknown>;
    private _simulatorOverrides : Map<string, string>;
    private _simulatorDatabase : MultiJSONDatabase|undefined;
    private _engine : Engine|undefined;

    private _state : 'loading'|'input'|'context'|'done'|'top3'|'full'|'code';
    private _serial : number;
    private _currentDialogue : ParsedDialogue|undefined;
    private _outputDialogue : DialogueTurn[];
    private _currentTurnIdx : number;
    private _dialogueState : 'user'|'agent';
    private _outputTurn : DialogueTurn|undefined;
    private _currentKey : Exclude<keyof DialogueTurn,'agent_timestamp'|'user_timestamp'>|undefined;
    private _context : ThingTalk.Ast.DialogueState|null;
    private _contextOverride : string|undefined;
    private _simulatorState : any|undefined;
    private _preprocessed : string|undefined;
    private _entities : EntityMap|undefined;
    private _candidates : ThingTalk.Ast.DialogueState[]|undefined;

    constructor(rl : readline.Interface,
                dialogues : Iterable<ParsedDialogue>,
                options : AnnotatorOptions) {
        super();

        this._rl = rl;
        this._nextDialogue = dialogues[Symbol.iterator]();
        this._hasExistingAnnotations = options.existing_annotations;
        this._editMode = options.edit_mode;
        if (options.only_ids)
            this._onlyIds = new Set(options.only_ids.split(','));
        else
            this._onlyIds = undefined;
        this._maxTurns = options.max_turns;

        this._locale = options.locale;
        this._timezone = options.timezone;
        this._userParser = ParserClient.get(options.user_nlu_server, options.locale);
        this._agentParser = ParserClient.get(options.agent_nlu_server, options.locale);

        this._simulatorOverrides = new Map();
        this._platform = new Platform(undefined, options.locale, options.thingpedia_url);
        const prefs = this._platform.getSharedPreferences();
        if (options.thingpedia_dir && options.thingpedia_dir.length)
            prefs.set('developer-dir', options.thingpedia_dir);
        this._tpClient = this._platform.getCapability('thingpedia-client')!;
        this._rng = seedrandom.alea('almond is awesome');

        if (options.execution_mode === 'simulation') {
            this._schemas = new ThingTalk.SchemaRetriever(this._tpClient, null, true);

            const simulatorOptions : ThingTalkUtils.SimulatorOptions = {
                rng: this._rng,
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

        this._state = 'loading';

        this._serial = options.offset - 1;

        this._currentDialogue = undefined;
        this._outputDialogue = [];
        this._currentTurnIdx = 0;
        this._dialogueState = 'user';
        this._outputTurn = undefined;
        this._currentKey = undefined;
        this._context = null;
        this._contextOverride = undefined;
        this._simulatorState = undefined;
        this._preprocessed = undefined;
        this._entities = undefined;
        this._candidates = undefined;

        rl.on('line', async (line) => {
            if (this._state === 'done')
                return;

            line = line.trim();

            if (this._state === 'context' && line.length === 0) {
                this._flushContextOverride().catch((e) => this.emit('error', e));
                return;
            }

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

            if (line === 'd' || line.startsWith('d ')) {
                const comment = line.substring(2).trim();

                if (this._outputDialogue.length > 0) {
                    this.emit('learned', {
                        id: this._currentDialogue!.id || this._serial,
                        turns: this._outputDialogue!,
                    });
                }

                this.emit('dropped', {
                    id: this._currentDialogue!.id || this._serial,
                    turns: this._currentDialogue!,
                    comment: `dropped at turn ${this._outputDialogue!.length+1}: ${comment}`
                });
                this._outputDialogue = [];
                this.next();
                return;
            }

            if (/^c: /i.test(line)) {
                this._addLineToContext(line.substring(3).trim());
                return;
            }

            if (this._state === 'code') {
                this._learnThingTalk(line).catch((e) => this.emit('error', e));
                return;
            }
            if (this._state === 'context') {
                if (/^c:/i.test(line))
                    line = line.substring(2).trim();
                this._addLineToContext(line);
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
    get conversation() {
        return {
            id: 'main',

            getState() {
                return {
                    history: [],
                    dialogueState: {},
                    lastMessageId: 0,
                    expected: null
                };
            }
        };
    }
    async reply(msg : string) {
        console.log('A: ' + msg);
    }
    async replyLink(title : string, link : string) {
        console.log('A: ' + title + ' ' + link);
    }

    interpolate(msg : string, args : Record<string, unknown>) : string {
        return interpolate(msg, args, {
            locale: this._locale,
            timezone: this._platform.timezone
        })||'';
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
        if (this._editMode) {
            if (this._currentTurnIdx > 0)
                console.log(`WARNING: the current dialogue (${this._currentDialogue!.id}) has not been saved, any change will be lost`);
            this.emit('learned', {
                id: this._currentDialogue!.id || this._serial,
                turns: this._currentDialogue!,
            });
            let { value, done } = this._nextDialogue.next();
            while (!done) {
                this.emit('learned', { id: value.id, turns: value });
                const result = this._nextDialogue.next();
                value = result.value;
                done = result.done;
            }
        }

        this.emit('quit');
    }

    private _help() {
        console.log('Available commands:');
        console.log('q: quit');
        console.log('d: (done/drop) complete the current dialog and start the next one');
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
        await this._userParser.start();
        await this._agentParser.start();
    }
    async stop() {
        await this._userParser.stop();
        await this._agentParser.stop();
        if (this._engine)
            await this._engine.stop();
    }

    private async _learnThingTalk(code : string) {
        let program;
        try {
            program = await ThingTalkUtils.parse(code, this._schemas);
            assert(program instanceof ThingTalk.Ast.DialogueState);

            // check that the entities are correct by serializing the program once
            ThingTalkUtils.serializePrediction(program, this._preprocessed!, this._entities!, {
                locale: this._locale,
                timezone: this._timezone,
            }).join(' ');
        } catch(e) {
            console.log(`${e.name}: ${e.message}`);
            this._rl.setPrompt('TT: ');
            this._rl.prompt();
            return;
        }

        const oldContext = this._context;
        this._context = ThingTalkUtils.computeNewState(this._context, program, this._dialogueState);
        const prediction = ThingTalkUtils.computePrediction(oldContext, this._context, this._dialogueState);
        this._outputTurn![this._currentKey!] = prediction.prettyprint();
        this._nextUtterance();
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
        this._context = ThingTalkUtils.computeNewState(this._context, program, this._dialogueState);
        const prediction = ThingTalkUtils.computePrediction(oldContext, this._context, this._dialogueState);
        this._outputTurn![this._currentKey!] = prediction.prettyprint();
        this._nextUtterance();
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
        if (this._outputDialogue.length > 0) {
            this.emit('learned', {
                id: this._currentDialogue!.id || this._serial,
                turns: this._outputDialogue,
            });
        }

        const { value: nextDialogue, done } = this._nextDialogue.next();
        if (done) {
            this.emit('end');
            return;
        }

        const shouldSkip = this._onlyIds && !this._onlyIds.has(nextDialogue.id);

        if (!shouldSkip) {
            if (this._serial > 0) {
                console.log();
                console.log();
                console.log();
            }
            console.log(`Dialog #${this._serial+1} (${nextDialogue.id})`);
        }
        this._serial++;

        this._currentDialogue = nextDialogue;
        this._outputDialogue = [];
        this._context = null;
        this._outputTurn = undefined;
        this._simulatorState = undefined;
        this._currentTurnIdx = -1;

        if (shouldSkip) {
            // skip this dialogue
            this.emit('learned', {
                id: nextDialogue.id,
                turns: nextDialogue,
            });
            setImmediate(() => {
                this.next();
            });
        } else {
            this._nextTurn();
        }
    }

    private _extractSimulatorOverrides(utterance : string) {
        const car = /\b(black|white|red|yellow|blue|grey) (toyota|skoda|bmw|honda|ford|audi|lexus|volvo|volkswagen|tesla)\b/.exec(utterance);
        if (car)
            this._simulatorOverrides.set('car', car[0]);

        for (const token of utterance.split(' ')) {
            // a reference number is an 8 character token containing both letters and numbers
            if (token.length === 8 && /[a-z]/.test(token) && /[0-9]/.test(token))
                this._simulatorOverrides.set('reference_number', token);
        }
    }

    private async _nextTurn() {
        if (this._outputTurn !== undefined)
            this._outputDialogue.push(this._outputTurn);
        this._currentTurnIdx ++;

        if (this._currentTurnIdx >= this._currentDialogue!.length) {
            this.next();
            return;
        }

        const currentTurn = this._currentDialogue![this._currentTurnIdx];

        if (this._currentTurnIdx > 0) {
            this._simulatorOverrides.clear();
            this._extractSimulatorOverrides(currentTurn.agent!);

            // "execute" the context
            const { newDialogueState, newExecutorState } = await this._executor.execute(this._context!, this._simulatorState);
            this._context = newDialogueState;
            this._simulatorState = newExecutorState;

            // sort all results based on the presence of the name in the agent utterance
            for (const item of this._context!.history) {
                if (item.results === null)
                    continue;

                if (item.results.results.length === 0)
                    continue;

                const firstResult = item.results.results[0];
                if (!firstResult.value.id)
                    continue;
                item.results.results.sort((one, two) => {
                    const idone = one.value.id;
                    const idtwo = two.value.id;
                    if (!(idone instanceof ThingTalk.Ast.EntityValue) ||
                        !(idtwo instanceof ThingTalk.Ast.EntityValue))
                        return 0;
                    const onerank = currentTurn.agent!.toLowerCase().indexOf(idone.display!.toLowerCase());
                    const tworank = currentTurn.agent!.toLowerCase().indexOf(idtwo.display!.toLowerCase());
                    if (onerank === tworank)
                        return 0;
                    if (onerank === -1)
                        return 1;
                    if (tworank === -1)
                        return -1;
                    return onerank - tworank;
                });
            }
        }


        const contextCode = (this._context ? this._context.prettyprint() : null);
        this._outputTurn = {
            context: contextCode,
            agent: currentTurn.agent,
            agent_target: '',
            intermediate_context: '',
            user: currentTurn.user,
            user_target: '',
        };

        this._state = 'input';
        this._dialogueState = (this._currentTurnIdx === 0 ? 'user' : 'agent');

        await this._handleUtterance();
    }

    private async _nextUtterance() {
        if (this._dialogueState === 'agent') {
            // "execute" the context again in case the agent introduced some executable result

            let anyChange = true;
            while (anyChange) {
                const { newDialogueState, newExecutorState, anyChange: newAnyChange } = await this._executor.execute(this._context!, this._simulatorState);
                this._context = newDialogueState;
                this._simulatorState = newExecutorState;
                anyChange = newAnyChange;
                if (anyChange)
                    this._outputTurn!.intermediate_context = this._context!.prettyprint();
            }

            this._dialogueState = 'user';
            await this._handleUtterance();
        } else {
            await this._nextTurn();
        }
    }

    private async _flushContextOverride() {
        if (!this._context || !this._contextOverride)
            return;

        let firstLine;
        if (this._dialogueState === 'user' && this._outputTurn!.intermediate_context)
            firstLine = this._outputTurn!.intermediate_context.split('\n')[0];
        else
            firstLine = this._outputTurn!.context!.split('\n')[0];

        let ctxOverride;
        try {
            ctxOverride = await ThingTalkUtils.parse(firstLine + '\n' + this._contextOverride, this._schemas);
            assert(ctxOverride instanceof ThingTalk.Ast.DialogueState);
        } catch(e) {
            console.log(`${e.name}: ${e.message}`);
            this._contextOverride = '';
            this._state = 'context';
            this._rl.setPrompt('C: ');
            this._rl.prompt();
            return;
        }

        // find the last item that has results, remove that and everything afterwards, and replace it with
        // what we parsed as the override
        let idx;
        for (idx = this._context.history.length-1; idx >= 0; idx--) {
            const item = this._context.history[idx];
            if (item.results !== null)
                break;
        }
        this._context.history.splice(idx, this._context.history.length-idx, ...ctxOverride.history);

        // save in the output
        if (this._dialogueState === 'user')
            this._outputTurn!.intermediate_context = this._context.prettyprint();
        else
            this._outputTurn!.context = this._context.prettyprint();

        // now handle the utterance again
        await this._handleUtterance();
    }

    private _addLineToContext(line : string) {
        if (this._contextOverride === undefined)
            this._contextOverride = '';
        this._contextOverride += line + '\n';
        this._state = 'context';
        this._rl.setPrompt('C: ');
        this._rl.prompt();
    }

    private async _handleUtterance() {
        if (this._context) {
            console.log();
            const contextCode = this._context.prettyprint();
            for (const line of contextCode.trim().split('\n'))
                console.log('C: ' + line);
        }
        this._contextOverride = undefined;

        const utterance = this._outputTurn![this._dialogueState]!;
        this._currentKey = (this._dialogueState + '_target') as ('user_target'|'agent_target');

        console.log((this._dialogueState === 'agent' ? 'A: ' : 'U: ') + utterance);
        this._state = 'loading';

        let contextCode, contextEntities;
        if (this._context !== null) {
            const context = ThingTalkUtils.prepareContextForPrediction(this._context, this._dialogueState);
            [contextCode, contextEntities] = ThingTalkUtils.serializeNormalized(context);
        } else {
            contextCode = ['null'];
            contextEntities = {};
        }

        const parser = this._dialogueState === 'agent' ? this._agentParser : this._userParser;
        const parsed = await parser.sendUtterance(utterance, contextCode, contextEntities, {
            tokenized: false,
            skip_typechecking: true
        });

        this._state = 'top3';
        this._preprocessed = parsed.tokens.join(' ');
        this._entities = parsed.entities;
        const candidates = await ThingTalkUtils.parseAllPredictions(parsed.candidates, parsed.entities, {
            timezone: this._timezone,
            thingpediaClient: this._tpClient,
            schemaRetriever: this._schemas
        }) as ThingTalk.Ast.DialogueState[];
        this._candidates = candidates;

        if (this._hasExistingAnnotations) {
            const currentTurn = this._currentDialogue![this._currentTurnIdx];
            const existing = currentTurn[this._currentKey!];
            if (existing) {
                try {
                    const program = await ThingTalkUtils.parse(existing, this._schemas);
                    assert(program instanceof ThingTalk.Ast.DialogueState);
                    candidates.unshift(program);
                } catch(e) {
                    console.log('WARNING: existing annotation fails to parse or typecheck: ' + e.message);
                }
            }
        }

        if (candidates.length > 0) {
            for (let i = 0; i < 3 && i < candidates.length; i++)
                console.log(`${i+1}) ${candidates[i].prettyprint()}`);
        } else {
            console.log(`No candidates for this program`);
        }

        if (this._maxTurns && this._currentTurnIdx >= this._maxTurns) {
            setTimeout(() => this._learnNumber(1), 1);
        } else {
            this._rl.setPrompt('$ ');
            this._rl.prompt();
        }
    }
}

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('manual-annotate-dialog', {
        add_help: true,
        description: `Interactively annotate a dialog dataset, by annotating each sentence turn-by-turn.`
    });
    parser.add_argument('--annotated', {
        required: true,
    });
    parser.add_argument('--dropped', {
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
        help: `Timezone to use to interpret dates and times (defaults to the current timezone).`
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
    parser.add_argument('-t', '--target-language', {
        required: false,
        default: 'thingtalk',
        choices: ['thingtalk', 'dlgthingtalk'],
        help: `The programming language to generate`
    });
    parser.add_argument('--execution-mode', {
        required: false,
        default: 'simulation',
        choices: ['simulation', 'real'],
        help: `Whether to simulate API calls or execute them for real.`
    });
    parser.add_argument('--database-file', {
        required: false,
        help: `Path to a file pointing to JSON databases used to simulate queries.`,
    });
    parser.add_argument('--user-nlu-server', {
        required: false,
        default: NLP_SERVER_URL,
        help: `The URL of the natural language server to parse user utterances. Use a file:// URL pointing to a model directory to use a local instance of genienlp.`
    });
    parser.add_argument('--agent-nlu-server', {
        required: false,
        default: NLP_SERVER_URL,
        help: `The URL of the natural language server to parse agent utterances. Use a file:// URL pointing to a model directory to use a local instance of genienlp.`
    });
    parser.add_argument('--offset', {
        required: false,
        type: parseInt,
        default: 1,
        help: `Start from the nth dialogue of the input tsv file.`
    });
    parser.add_argument('--existing-annotations', {
        action: 'store_true',
        help: 'The input file already has annotations.',
        default: false
    });
    parser.add_argument('--edit-mode', {
        action: 'store_true',
        help: 'Edit an existing annotated dataset instead of creating a new one (implies --existing-annotations).',
        default: false
    });
    parser.add_argument('--only-ids', {
        required: false,
        help: 'Only annotate the dialogues with the given IDs, comma-separated (must be given with --existing-annotations)',
        default: ''
    });
    parser.add_argument('--max-turns', {
        required: false,
        help: 'Auto-annotate after the given number of turns',
    });
    parser.add_argument('--append', {
        action: 'store_true',
        help: 'Append to the output file instead of overwriting (implied by --edit-mode or --offset > 1)',
    });
    parser.add_argument('--no-append', {
        action: 'store_true',
        help: 'Overwrite the output file instead of appending (overrides --append, --edit-mode and --offset)',
    });
    parser.add_argument('input_file', {
        nargs: '+',
        type: fs.createReadStream,
        help: 'Input dialog file'
    });

}

export async function execute(args : any) {
    if (args.edit_mode)
        args.existing_annotations = true;
    if (args.only_ids && !args.existing_annotations)
        throw new Error(`--only-ids is only valid in edit mode (with --existing-annotations)`);

    let dialogues = await readAllLines(args.input_file, '====')
        .pipe(new DialogueParser({ withAnnotations: args.existing_annotations }))
        .pipe(new StreamUtils.ArrayAccumulator<ParsedDialogue>())
        .read();


    const learned = new DialogueSerializer({ annotations: true });
    let appendLearned, appendDropped;
    if (args.no_append) {
        appendLearned = false;
        appendDropped = false;
    } else if (args.append) {
        appendLearned = true;
        appendDropped = true;
    } else {
        appendLearned = (args.offset > 1 && !args.edit_mode);
        appendDropped = (args.offset > 1 || args.edit_mode);
    }

    learned.pipe(fs.createWriteStream(args.annotated, { flags: (appendLearned ? 'a' : 'w') }));
    const dropped = new DialogueSerializer({ annotations: false });
    dropped.pipe(fs.createWriteStream(args.dropped, { flags: (appendDropped ? 'a' : 'w') }));

    if (args.edit_mode) {
        // copy over the existing dialogues if we're in editing mode
        for (let i = 0; i < args.offset-1; i++)
            learned.write({ id: dialogues[i].id, turns: dialogues[i] });
    }

    if (args.offset > 1)
        dialogues = dialogues.slice(args.offset-1);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.setPrompt('$ ');

    function quit() {
        learned.end();
        dropped.end();
        rl.close();
        //process.exit();
    }

    const annotator = new Annotator(rl, dialogues, args);
    await annotator.start();


    annotator.on('end', quit);
    annotator.on('learned', (dlg) => {
        learned.write(dlg);
    });
    annotator.on('dropped', (dlg) => {
        dropped.write(dlg);
    });
    annotator.on('quit', quit);
    rl.on('SIGINT', quit);
    annotator.next();
    //process.stdin.on('end', quit);

    await Promise.all([
        StreamUtils.waitFinish(learned),
        StreamUtils.waitFinish(dropped),
    ]);
    await annotator.stop();

    console.log('All dialogues annotated, waiting 30 seconds to quit...');
    setTimeout(() => process.exit(), 30000);
}
