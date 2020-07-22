// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
"use strict";

const fs = require('fs');
const readline = require('readline');
const events = require('events');
const seedrandom = require('seedrandom');
const Tp = require('thingpedia');
const ThingTalk = require('thingtalk');

const TargetLanguages = require('../lib/languages');
const StreamUtils = require('../lib/utils/stream-utils');
const ParserClient = require('../lib/prediction/parserclient');
const { DialogueParser, DialogueSerializer } = require('../lib/dataset-tools/parsers');

const { readAllLines } = require('./lib/argutils');
const MultiJSONDatabase = require('./lib/multi_json_database');

class Annotator extends events.EventEmitter {
    constructor(rl, dialogues, options) {
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

        const tpClient = new Tp.FileClient(options);
        this._schemas = new ThingTalk.SchemaRetriever(tpClient, null, true);
        this._userParser = ParserClient.get(options.user_nlu_server, options.locale);
        this._agentParser = ParserClient.get(options.agent_nlu_server, options.locale);
        this._target = TargetLanguages.get(options.target_language);

        this._simulatorOverrides = new Map;
        const simulatorOptions = {
            rng: seedrandom.alea('almond is awesome'),
            locale: options.locale,
            thingpediaClient: tpClient,
            schemaRetriever: this._schemas,
            overrides: this._simulatorOverrides,
        };
        if (options.database_file) {
            this._database = new MultiJSONDatabase(options.database_file);
            simulatorOptions.database = this._database;
        }

        this._simulator = this._target.createSimulator(simulatorOptions);

        this._state = 'loading';

        this._serial = options.offset - 1;

        this._currentDialogue = undefined;
        this._outputDialogue = [];
        this._currentTurnIdx = undefined;
        this._outputTurn = undefined;
        this._currentKey = undefined;
        this._context = undefined;
        this._simulatorState = undefined;
        this._dialogState = undefined;
        this._utterance = undefined;
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
                let comment = line.substring(2).trim();
                if (!comment && this._comment)
                    comment = this._comment;

                if (this._outputDialogue.length > 0) {
                    this.emit('learned', {
                        id: this._currentDialogue.id || this._serial,
                        turns: this._outputDialogue,
                    });
                }

                this.emit('dropped', {
                    id: this._currentDialogue.id || this._serial,
                    turns: this._currentDialogue,
                    comment: `dropped at turn ${this._outputDialogue.length+1}: ${comment}`
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

    _quit() {
        if (this._editMode) {
            if (this._currentTurnIdx > 0)
                console.log(`WARNING: the current dialogue (${this._currentDialogue.id}) has not been saved, any change will be lost`);
            this.emit('learned', {
                id: this._currentDialogue.id || this._serial,
                turns: this._currentDialogue,
            });
            let { value, done } = this._nextDialogue.next();
            while (!done) {
                this.emit('learned', { id: value.id, turns: value });
                let result = this._nextDialogue.next();
                value = result.value;
                done = result.done;
            }
        }

        this.emit('quit');
    }

    _help() {
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
        if (this._database)
            await this._database.load();
        await this._userParser.start();
        await this._agentParser.start();
    }
    async stop() {
        await this._userParser.start();
        await this._agentParser.start();
    }

    async _learnThingTalk(code) {
        let program;
        try {
            program = await ThingTalk.Grammar.parseAndTypecheck(code, this._schemas);

            const clone = {};
            Object.assign(clone, this._entities);
            ThingTalk.NNSyntax.toNN(program, this._preprocessed, clone, { allocateEntities: false });
        } catch(e) {
            console.log(`${e.name}: ${e.message}`);
            this._rl.setPrompt('TT: ');
            this._rl.prompt();
            return;
        }

        const oldContext = this._context;
        this._context = this._target.computeNewState(this._context, program, this._dialogueState);
        const prediction = this._target.computePrediction(oldContext, this._context, this._dialogueState);
        this._outputTurn[this._currentKey] = prediction.prettyprint();
        this._nextUtterance();
    }

    _edit(i) {
        let program;
        if (i === undefined) {
            program = this._context;
        } else {
            if (Number.isNaN(i) || i < 1 || i > this._candidates.length) {
                console.log('Invalid number');
                this._rl.setPrompt('$ ');
                this._rl.prompt();
                return;
            }
            i -= 1;
            program = this._candidates[i];
        }
        this._state = 'code';
        this._rl.setPrompt('TT: ');
        this._rl.write(program.prettyprint(true).replace(/\n/g, ' '));
        this._rl.prompt();
    }

    _learnNumber(i) {
        if (i < 1 || i > this._candidates.length) {
            console.log('Invalid number');
            this._rl.setPrompt('$ ');
            this._rl.prompt();
            return;
        }
        i -= 1;

        const program = this._candidates[i];
        const oldContext = this._context;
        this._context = this._target.computeNewState(this._context, program, this._dialogueState);
        const prediction = this._target.computePrediction(oldContext, this._context, this._dialogueState);
        this._outputTurn[this._currentKey] = prediction.prettyprint();
        this._nextUtterance();
    }

    _more() {
        if (this._state === 'top3') {
            this._state = 'full';
            console.log(`Sentence #${this._serial+1} (${this._id}): ${this._utterance}`);
            for (let i = 0; i < this._candidates.length; i++)
                console.log(`${i+1}) ${this._candidates[i].code.join(' ')}`);
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
                id: this._currentDialogue.id || this._serial,
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

    _extractSimulatorOverrides(utterance) {
        const car = /\b(black|white|red|yellow|blue|grey) (toyota|skoda|bmw|honda|ford|audi|lexus|volvo|volkswagen|tesla)\b/.exec(utterance);
        if (car)
            this._simulatorOverrides.set('car', car[0]);

        for (let token of utterance.split(' ')) {
            // a reference number is an 8 character token containing both letters and numbers
            if (token.length === 8 && /[a-z]/.test(token) && /[0-9]/.test(token))
                this._simulatorOverrides.set('reference_number', token);
        }
    }

    async _nextTurn() {
        if (this._outputTurn !== undefined)
            this._outputDialogue.push(this._outputTurn);
        this._currentTurnIdx ++;

        if (this._currentTurnIdx >= this._currentDialogue.length) {
            this.next();
            return;
        }

        const currentTurn = this._currentDialogue[this._currentTurnIdx];

        if (this._currentTurnIdx > 0) {
            this._simulatorOverrides.clear();
            this._extractSimulatorOverrides(currentTurn.agent);

            // "execute" the context
            [this._context, this._simulatorState] = await this._simulator.execute(this._context, this._simulatorState);

            // sort all results based on the presence of the name in the agent utterance
            for (let item of this._context.history) {
                if (item.results === null)
                    continue;

                if (item.results.results.length === 0)
                    continue;

                let firstResult = item.results.results[0];
                if (!firstResult.value.id)
                    continue;
                item.results.results.sort((one, two) => {
                    const onerank = currentTurn.agent.toLowerCase().indexOf(one.value.id.display.toLowerCase());
                    const tworank = currentTurn.agent.toLowerCase().indexOf(two.value.id.display.toLowerCase());
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
            user: currentTurn.user,
            user_target: '',
        };

        this._state = 'input';
        this._dialogueState = (this._currentTurnIdx === 0 ? 'user' : 'agent');

        this._utterance = undefined;
        await this._handleUtterance();
    }

    async _nextUtterance() {
        if (this._dialogueState === 'agent') {
            // "execute" the context again in case the agent introduced some executable result

            let anyChange = true;
            while (anyChange) {
                [this._context, this._simulatorState, anyChange] = await this._simulator.execute(this._context, this._simulatorState);
                if (anyChange)
                    this._outputTurn.intermediate_context = this._context.prettyprint();
            }

            this._dialogueState = 'user';
            await this._handleUtterance();
        } else {
            await this._nextTurn();
        }
    }

    async _flushContextOverride() {
        if (!this._context || !this._contextOverride)
            return;

        let firstLine;
        if (this._dialogueState === 'user' && this._outputTurn.intermediate_context)
            firstLine = this._outputTurn.intermediate_context.split('\n')[0];
        else
            firstLine = this._outputTurn.context.split('\n')[0];

        let ctxOverride;
        try {
            ctxOverride = await ThingTalk.Grammar.parseAndTypecheck(firstLine + '\n' + this._contextOverride, this._schemas);
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
            this._outputTurn.intermediate_context = this._context.prettyprint();
        else
            this._outputTurn.context = this._context.prettyprint();

        // now handle the utterance again
        await this._handleUtterance();
    }

    _addLineToContext(line) {
        if (this._contextOverride === undefined)
            this._contextOverride = '';
        this._contextOverride += line + '\n';
        this._state = 'context';
        this._rl.setPrompt('C: ');
        this._rl.prompt();
    }

    async _handleUtterance() {
        if (this._context) {
            console.log();
            const contextCode = this._context.prettyprint();
            for (let line of contextCode.trim().split('\n'))
                console.log('C: ' + line);
        }
        this._contextOverride = undefined;

        this._utterance = this._outputTurn[this._dialogueState];
        this._currentKey = this._dialogueState + '_target';

        console.log((this._dialogueState === 'agent' ? 'A: ' : 'U: ') + this._utterance);
        this._state = 'loading';

        let contextCode, contextEntities;
        if (this._context !== null) {
            const context = this._target.prepareContextForPrediction(this._context, this._dialogueState);
            [contextCode, contextEntities] = this._target.serializeNormalized(context);
        } else {
            contextCode = ['null'];
            contextEntities = {};
        }

        const parser = this._dialogueState === 'agent' ? this._agentParser : this._userParser;
        const parsed = await parser.sendUtterance(this._utterance, contextCode, contextEntities, {
            tokenized: false,
            skip_typechecking: true
        });

        this._state = 'top3';
        this._preprocessed = parsed.tokens.join(' ');
        this._entities = parsed.entities;
        this._candidates = (await Promise.all(parsed.candidates.map(async (cand) => {
            try {
                const program = ThingTalk.NNSyntax.fromNN(cand.code, parsed.entities);
                await program.typecheck(this._schemas);

                // convert the program to NN syntax once, which will force the program to be syntactically normalized
                // (and therefore rearrange slot-fill by name rather than Thingpedia order)
                ThingTalk.NNSyntax.toNN(program, '', {}, { allocateEntities: true });
                return program;
            } catch(e) {
                return null;
            }
        }))).filter((c) => c !== null);

        if (this._hasExistingAnnotations) {
            const currentTurn = this._currentDialogue[this._currentTurnIdx];
            const existing = currentTurn[this._currentKey];
            if (existing) {
                try {
                    const program = await ThingTalk.Grammar.parseAndTypecheck(existing, this._schemas, false);
                    this._candidates.unshift(program);
                } catch(e) {
                    console.log('WARNING: existing annotation fails to parse or typecheck: ' + e.message);
                }
            }
        }

        if (this._candidates.length > 0) {
            for (var i = 0; i < 3 && i < this._candidates.length; i++)
                console.log(`${i+1}) ${this._candidates[i].prettyprint()}`);
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

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('manual-annotate-dialog', {
            addHelp: true,
            description: `Interactively annotate a dialog dataset, by annotating each sentence turn-by-turn.`
        });
        parser.addArgument('--annotated', {
            required: true,
        });
        parser.addArgument('--dropped', {
            required: true,
        });
        parser.addArgument('--offset', {
            required: false,
            type: parseInt,
            defaultValue: 1,
            help: `Start from the nth dialogue of the input tsv file.`
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the natural language being processed (defaults to en-US).`
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.addArgument(['-t', '--target-language'], {
            required: false,
            defaultValue: 'thingtalk',
            choices: TargetLanguages.AVAILABLE_LANGUAGES,
            help: `The programming language to generate`
        });
        parser.addArgument('--database-file', {
            required: false,
            help: `Path to a file pointing to JSON databases used to simulate queries.`,
        });
        parser.addArgument('--user-nlu-server', {
            required: false,
            defaultValue: 'http://127.0.0.1:8400',
            help: `The URL of the natural language server to parse user utterances. Use a file:// URL pointing to a model directory to use a local instance of genienlp.`
        });
        parser.addArgument('--agent-nlu-server', {
            required: false,
            defaultValue: 'http://127.0.0.1:8400',
            help: `The URL of the natural language server to parse agent utterances. Use a file:// URL pointing to a model directory to use a local instance of genienlp.`
        });
        parser.addArgument('--existing-annotations', {
            nargs: 0,
            action: 'storeTrue',
            help: 'The input file already has annotations.',
            defaultValue: false
        });
        parser.addArgument('--edit-mode', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Edit an existing annotated dataset instead of creating a new one (implies --existing-annotations).',
            defaultValue: false
        });
        parser.addArgument('--only-ids', {
            required: false,
            help: 'Only annotate the dialogues with the given IDs, comma-separated (must be given with --existing-annotations)',
            defaultValue: ''
        });
        parser.addArgument('--max-turns', {
            required: false,
            help: 'Auto-annotate after the given number of turns',
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: fs.createReadStream,
            help: 'Input dialog file'
        });

    },

    async execute(args) {
        if (args.edit_mode)
            args.existing_annotations = true;
        if (args.only_ids && !args.existing_annotations)
            throw new Error(`--only-ids is only valid in edit mode (with --existing-annotations)`);

        let dialogues = await readAllLines(args.input_file, '====')
            .pipe(new DialogueParser({ withAnnotations: args.existing_annotations }))
            .pipe(new StreamUtils.ArrayAccumulator())
            .read();


        const learned = new DialogueSerializer({ annotations: true });
        learned.pipe(fs.createWriteStream(args.annotated, { flags: ((args.offset > 1 && !args.edit_mode) ? 'a' : 'w') }));
        const dropped = new DialogueSerializer({ annotations: false });
        dropped.pipe(fs.createWriteStream(args.dropped, { flags: ((args.offset > 1 || args.edit_mode) ? 'a' : 'w') }));

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
};
