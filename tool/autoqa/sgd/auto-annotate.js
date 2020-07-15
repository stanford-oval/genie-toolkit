// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Lucas Sato <satojk@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');
const fs = require('fs');
const util = require('util');
const stream = require('stream');
const seedrandom = require('seedrandom');
const Tp = require('thingpedia');
const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const ParserClient = require('../../../lib/prediction/parserclient');
const { DialogueSerializer } = require('../../lib/dialog_parser');
const StreamUtils = require('../../../lib/utils/stream-utils');
const MultiJSONDatabase = require('../../lib/multi_json_database');
const ProgressBar = require('../../lib/progress_bar');
const { getBestEntityMatch } = require('../../../lib/dialogue-agent/entity-linking/entity-finder');
const TargetLanguages = require('../../../lib/languages');

const POLICY_NAME = 'org.thingpedia.dialogue.transaction';

class Converter extends stream.Readable {
    constructor(args) {
        super({ objectMode: true });
        this._tpClient = new Tp.FileClient(args);
        this._schemas = new ThingTalk.SchemaRetriever(this._tpClient, null, true);

        this._target = TargetLanguages.get('thingtalk');
        const simulatorOptions = {
            rng: seedrandom.alea('almond is awesome'),
            locale: 'en-US',
            thingpediaClient: this._tpClient,
            schemaRetriever: this._schemas,
            forceEntityResolution: true,
        };
        this._database = new MultiJSONDatabase(args.database_file);
        simulatorOptions.database = this._database;
        this._simulator = this._target.createSimulator(simulatorOptions);
    }

    _read() {}

    async start() {
        await this._database.load();
    }

    async _getContextInfo(state) {
        let next = null, current = null;
        for (let idx = 0; idx < state.history.length; idx ++) {
            const item = state.history[idx];
            if (item.results === null) {
                next = item;
                break;
            }
            current = item;
        }

        return { current, next };
    }

    async _doAgentTurn(context, contextInfo, turn, agentUtterance) {
        let agentTarget = new Ast.DialogueState(null, POLICY_NAME, 'sys_invalid', null, []);

        return agentTarget;
    }

    async _doUserTurn(context, contextInfo, turn, userUtterance, slotBag) {
        let userTarget = new Ast.DialogueState(null, POLICY_NAME, 'invalid', null, []);

        return userTarget;
    }

    async _doDialogue(dlg) {
        const id = dlg.dialogue_id;

        let context = null, contextInfo = { current: null, next: null },
            simulatorState = undefined, slotBag = new Map;
        const turns = [];
        for (let idx = 0; idx < dlg.turns.length; idx = idx+2) {
            const uHalfTurn = dlg.turns[idx];
            const aHalfTurn = dlg.turns[idx+1];

            try {
                let contextCode = '', agentUtterance = '', agentTargetCode = '';
                agentUtterance = aHalfTurn.utterance;

                if (context !== null) {

                    // "execute" the context
                    [context, simulatorState] = await this._simulator.execute(context, simulatorState);

                    for (let item of context.history) {
                        if (item.results === null)
                            continue;

                        if (item.results.results.length === 0)
                            continue;

                        let firstResult = item.results.results[0];
                        if (!firstResult.value.id)
                            continue;
                        item.results.results.sort((one, two) => {
                            const onerank = agentUtterance.toLowerCase().indexOf(one.value.id.display.toLowerCase());
                            const tworank = agentUtterance.toLowerCase().indexOf(two.value.id.display.toLowerCase());
                            if (onerank === tworank)
                                return 0;
                            if (onerank === -1)
                                return 1;
                            if (tworank === -1)
                                return -1;
                            return onerank - tworank;
                        });
                    }
                    contextInfo = this._getContextInfo(context);
                    contextCode = context.prettyprint();

                    // do the agent
                    const agentTarget = await this._doAgentTurn(context, contextInfo, aHalfTurn, agentUtterance);
                    const oldContext = context;
                    context = this._target.computeNewState(context, agentTarget, 'agent');
                    const prediction = this._target.computePrediction(oldContext, context, 'agent');
                    agentTargetCode = prediction.prettyprint();
                }

                const userUtterance = uHalfTurn.utterance;
                const userTarget = await this._doUserTurn(context, contextInfo, uHalfTurn, userUtterance, slotBag);
                const oldContext = context;
                context = this._target.computeNewState(context, userTarget, 'user');
                const prediction = this._target.computePrediction(oldContext, context, 'user');
                const userTargetCode = prediction.prettyprint();
                
                turns.push({
                    context: contextCode,
                    agent: agentUtterance,
                    agent_target: agentTargetCode,
                    user: userUtterance,
                    user_target: userTargetCode,
                });

            } catch(e) {
                console.error(`Failed in dialogue ${id}`);
                console.error(uHalfTurn);
                throw e;
            }
        }

        return { id, turns };
    }

    async run(data) {
        for (let i = 0; i < data.length; i++) {
            this.push(await this._doDialogue(data[i]));
            this.emit('progress', i/data.length);
        }

        this.emit('progress', 1);
        this.push(null);
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('sgd-auto-annotate', {
            addHelp: true,
            description: 'Automatically annotate SGD dataset using SGD files.'
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument(['--cache-file'], {
            required: false,
            defaultValue: './sgd_dialogues.json',
            help: 'Path to a cache file containing the schema definitions.'
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.',
        });
        parser.addArgument('--database-file', {
            required: false,
            help: `Path to a file pointing to JSON databases used to simulate queries.`,
        });
        parser.addArgument(['--input_file'], {
            required: true,
            help: 'Input dialog file'
        });
    },

    async execute(args) {
        const data = JSON.parse(await util.promisify(fs.readFile)(args.input_file, { encoding: 'utf8' }));

        const converter = new Converter(args);
        const learned = new DialogueSerializer({ annotations: true });
        const promise = StreamUtils.waitFinish(converter.pipe(learned).pipe(args.output));

        const progbar = new ProgressBar(1);
        converter.on('progress', (value) => {
            progbar.update(value);
        });

        // issue an update now to show the progress bar
        progbar.update(0);

        //await converter.start();
        await converter.run(data);

        console.log('Finished, waiting for pending writes...');
        await promise;
        console.log('Everything done...');

        // we need this otherwise we hang at exit, due to some open file I cannot find...
        setTimeout(() => process.exit(), 10000);
    }
};
