// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const seedrandom = require('seedrandom');
const readline = require('readline');
const events = require('events');
const Tp = require('thingpedia');

const ParserClient = require('./lib/parserclient');
const I18n = require('../lib/i18n');

const ThingTalk = require('thingtalk');

function detokenizeSentence(langPack, tokens) {
    let sentence = '';
    let prevToken = '';
    for (let token of tokens) {
        sentence = langPack.detokenize(sentence, prevToken, token);
        prevToken = token;
    }
    return sentence;
}

class DialogAgent extends events.EventEmitter {
    constructor(rl, options) {
        super();
        this._rl = rl;

        const tpClient = new Tp.FileClient(options);
        this._schemas = new ThingTalk.SchemaRetriever(tpClient, null, true);
        this._parser = ParserClient.get(options.server, 'en-US');
        this._langPack = I18n.get(options.locale);
        this._rng = seedrandom.alea(options.random_seed),

        this._state = 'loading';
        this._serial = 0;

        // FIXME command-line argument
        this._target = require('../lib/languages/dlgthingtalk');
        this._targetOptions = {
            thingpediaClient: tpClient,
            schemaRetriever: this._schemas,
            debug: true
        };
        this._simulator = this._target.createSimulator({
            rng: this._rng
        });

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
        await this._parser.start();
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

    async _getProgramPrediction(candidates, entities, prefix) {
        candidates = (await Promise.all(candidates.map(async (cand) => {
            const parsed = await this._target.parsePrediction(cand.answer, entities, this._targetOptions);
            if (parsed === null)
                return null;
            return [parsed, cand.answer.split(' ')];
        }))).filter((c) => c !== null);

        if (candidates.length === 0)
            return [null, null];

        const prediction = candidates[0];
        console.log(prefix + prediction[0].prettyprint());
        return [this._target.computeNewState(this._context, prediction[0]), prediction[1]];
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

        const executed = await this._simulator.execute(userState);
        this._context = executed;

        console.log('C: ' + this._context.prettyprint());
        [this._contextCode, this._contextEntities] = this._target.serializeNormalized(this._context);

        const decisions = await this._parser.queryPolicy(this._contextCode, this._contextEntities);
        const [agentState, agentCode] = await this._getProgramPrediction(decisions, this._contextEntities, 'AT: ');
        if (agentState === null) {
            console.log(`A: Sorry, I don't know what to do next.`); //'
            this.nextDialog();
            return;
        }

        const utterances = await this._parser.generateUtterance(this._contextCode, this._contextEntities, agentCode);
        if (utterances.length === null) {
            console.log(`A: Sorry, I don't know what to say now.`); //'
            this.nextDialog();
            return;
        }
        // FIXME we should true-case as well
        console.log(`A: ` + detokenizeSentence(this._langPack, utterances[0].answer.split(' ')));
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
        parser.addArgument('--server', {
            required: true,
            help: `The URL of the natural language server. Use a file:// URL pointing to a model directory to evaluate using a local instance of decanlp.`
        });
        parser.addArgument('--random-seed', {
            defaultValue: 'almond is awesome',
            help: 'Random seed'
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
