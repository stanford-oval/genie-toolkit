// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const seedrandom = require('seedrandom');
const readline = require('readline');
const events = require('events');
const path = require('path');
const Tp = require('thingpedia');

const { AVAILABLE_LANGUAGES } = require('../lib/languages');
const ParserClient = require('./lib/parserclient');
const I18n = require('../lib/i18n');
const MultiJSONDatabase = require('./lib/multi_json_database');
const { SentenceGenerator } = require('../lib/sentence-generator');

const ThingTalk = require('thingtalk');

const USE_NEURAL_POLICY = false;
const MAX_DEPTH = 9;
const TARGET_PRUNING_SIZE = 20;

class DialogAgent extends events.EventEmitter {
    constructor(rl, options) {
        super();
        this._rl = rl;

        const tpClient = new Tp.FileClient(options);
        this._schemas = new ThingTalk.SchemaRetriever(tpClient, null, true);
        this._parser = ParserClient.get(options.server, 'en-US');
        this._langPack = I18n.get(options.locale);
        this._rng = seedrandom.alea(options.random_seed);
        this._debug = options.debug;

        this._state = 'loading';
        this._serial = 0;

        this._target = require('../lib/languages/' + options.target_language);
        this._targetOptions = {
            thingpediaClient: tpClient,
            schemaRetriever: this._schemas
        };

        const simulatorOptions = {
            rng: this._rng,
            locale: options.locale,
            thingpediaClient: tpClient,
            schemaRetriever: this._schemas
        };
        if (options.database_file) {
            this._database = new MultiJSONDatabase(options.database_file);
            simulatorOptions.database = this._database;
        }

        this._simulator = this._target.createSimulator(simulatorOptions);
        this._simulatorState = undefined;

        if (!USE_NEURAL_POLICY) {
            this._sentenceGenerator = new SentenceGenerator(this._target, {
                contextual: true,
                rootSymbol: '$agent',
                flags: {
                    // FIXME
                    dialogues: true,
                },
                rng: this._rng,
                locale: options.locale,
                templateFiles: options.template,
                targetLanguage: options.target_language,
                thingpediaClient: tpClient,
                maxDepth: MAX_DEPTH,
                targetPruningSize: TARGET_PRUNING_SIZE,
                debug: false,
            });
        }

        this._dialogState = undefined;
        this._context = undefined;
        this._contextCode = undefined;
        this._contextEntities = undefined;

        rl.on('line', async (line) => {
            if (this._state === 'done')
                return;

            line = line.trim();

            if (line.length === 0 || this._state === 'loading') {
                rl.prompt();
                return;
            }

            if (line === 'q') {
                this.quit();
                return;
            }

            if (line === 'h' || line === '?') {
                this._help();
                return;
            }

            if (line === 'd') {
                this.nextDialog();
                return;
            }

            if (this._state === 'input') {
                this._utterance = line;
                this._handleInput().catch((e) => this.emit('error', e));
                return;
            }

            console.log('Invalid command');
            rl.prompt();
        });
    }

    quit() {
        console.log('Bye\n');
        this._rl.close();
        this.emit('quit');
    }

    _help() {
        console.log('Available commands:');
        console.log('q: quit');
        console.log('d: (done) complete the current dialog and start the next one');
        console.log('? or h: this help');
    }

    async start() {
        if (this._database)
            await this._database.load();
        await this._parser.start();
        if (!USE_NEURAL_POLICY)
            await this._sentenceGenerator.initialize();

        this.nextDialog();
    }
    async stop() {
        await this._parser.stop();
    }

    nextDialog() {
        if (this._serial > 0)
            console.log();
        console.log(`Dialog #${this._serial+1}`);
        this._serial++;

        this._simulatorState = undefined;
        this._context = null;
        this._contextCode = ['null'];
        this._contextEntities = {};
        this._dialogState = 'initial';
        this.nextTurn();
    }
    nextTurn() {
        this._state = 'input';
        this._utterance = undefined;
        this._rl.setPrompt('U: ');
        this._rl.prompt();
    }

    /*_hackNetworkPredictions(candidates) {
        for (let cand of candidates) {
            if (cand.answer.startsWith('$dialogue @org.thingpedia.dialogue.transaction.sys_search_question '))
                cand.answer = cand.answer.substring(0, cand.answer.indexOf(';') + 1);
        }
    }
    */

    async _getProgramPrediction(candidates, entities, prefix) {
        candidates = (await Promise.all(candidates.map(async (cand) => {
            const parsed = await this._target.parsePrediction(cand.code, entities, this._targetOptions);
            if (parsed === null)
                return null;
            return [parsed, cand.code];
        }))).filter((c) => c !== null);

        if (candidates.length === 0)
            return [null, null];

        const prediction = candidates[0];
        if (this._debug)
            this._print(prediction[0].prettyprint(), prefix);
        return [this._target.computeNewState(this._context, prediction[0]), prediction[1]];
    }

    _print(code, prefix) {
        for (const line of code.trim().split('\n'))
            console.log(prefix + line);
    }

    _setContext(context, forTarget) {
        this._context = context;
        if (context !== null) {
            context = this._target.prepareContextForPrediction(context, forTarget);
            [this._contextCode, this._contextEntities] = this._target.serializeNormalized(context);
        } else {
            this._contextCode = ['null'];
            this._contextEntities = {};
        }
    }

    async _neuralPolicy() {
        const decisions = await this._parser.queryPolicy(this._contextCode, this._contextEntities);
        //this._hackNetworkPredictions(decisions);
        const [agentState, agentCode] = await this._getProgramPrediction(decisions, this._contextEntities, 'AT: ');
        if (agentState === null) {
            console.log(`A: Sorry, I don't know what to do next.`); //'
            this.nextDialog();
            return [undefined, undefined];
        }

        const utterances = await this._parser.generateUtterance(this._contextCode, this._contextEntities, agentCode);
        if (utterances.length === null) {
            console.log(`A: Sorry, I don't know what to say now.`); //'
            this.nextDialog();
            return [undefined, undefined];
        }

        return [agentState, utterances[0].answer];
    }

    async _heuristicPolicy() {
        const derivation = this._sentenceGenerator.generateOne({ context: this._context });
        if (derivation === undefined) {
            console.log(`A: Sorry, I don't know what to do next.`); //'
            this.nextDialog();
            return [undefined, undefined];
        }

        return [derivation.value, derivation.toString()];
    }

    async _handleInput() {
        this._state = 'loading';

        const parsed = await this._parser.sendUtterance(this._utterance, false, this._contextCode, this._contextEntities);
        const [userState,] = await this._getProgramPrediction(parsed.candidates, parsed.entities, 'UT: ');
        if (userState === null) {
            console.log(`A: Sorry, I did not understand that.`);
            this.nextTurn();
            return;
        }

        const [executed, simulatorState] = await this._simulator.execute(userState, this._simulatorState);
        this._simulatorState = simulatorState;
        this._setContext(executed);

        let agentState, utterance;
        if (USE_NEURAL_POLICY)
            [agentState, utterance] = await this._neuralPolicy();
        else
            [agentState, utterance] = await this._heuristicPolicy();

        if (agentState === undefined || utterance === undefined)
            return;

        console.log(`A: ` + utterance);
        this._print(agentState.prettyprint(), 'C: ');
        this._setContext(agentState);
        this.nextTurn();
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('demo-dialog', {
            addHelp: true,
            description: `Test a dialogue agent interactively.`
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
            defaultValue: 'dlgthingtalk',
            choices: AVAILABLE_LANGUAGES,
            help: `The programming language to generate`
        });
        parser.addArgument('--database-file', {
            required: false,
            help: `Path to a file pointing to JSON databases used to simulate queries.`,
        });
        parser.addArgument('--template', {
            nargs: '+',
            defaultValue: [path.resolve(path.dirname(module.filename), '../languages/thingtalk/en/dialogue.genie')],
            help: 'Path to file containing construct templates, in Genie syntax.'
        });
        parser.addArgument('--entities', {
            required: false,
            help: 'Path to JSON file containing entity type definitions.'
        });
        parser.addArgument('--dataset', {
            required: false,
            help: 'Path to file containing primitive templates, in ThingTalk syntax.'
        });
        parser.addArgument('--server', {
            required: false,
            defaultValue: 'http://127.0.0.1:8400',
            help: `The URL of the natural language server.`
        });
        parser.addArgument('--random-seed', {
            defaultValue: 'almond is awesome',
            help: 'Random seed'
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
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.setPrompt('$ ');

        const agent = new DialogAgent(rl, args);
        rl.on('SIGINT', () => agent.quit());
        await agent.start();
        //process.stdin.on('end', quit);

        await new Promise((resolve, reject) => {
            agent.on('error', reject);
            agent.on('quit', resolve);
        });
        await agent.stop();
    }
};
