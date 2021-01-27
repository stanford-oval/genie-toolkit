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

import assert from 'assert';
import * as argparse from 'argparse';
import * as fs from 'fs';
import * as Stream from 'stream';
import seedrandom from 'seedrandom';
import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';

import * as ThingTalkUtils from '../lib/utils/thingtalk';
import * as StreamUtils from '../lib/utils/stream-utils';
import {
    DialogueParser,
    DialogueSerializer,
    ParsedDialogue,
    DialogueTurn,
    DialogueExample,
} from '../lib/dataset-tools/parsers';
import DialoguePolicy from '../lib/dialogue-agent/dialogue_policy';

import { readAllLines } from './lib/argutils';
import MultiJSONDatabase from './lib/multi_json_database';

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('simulate-dialogs', {
        add_help: true,
        description: `Simulate execution and run the dialogue agent on a dialogue dataset, advancing to the next turn.`
    });
    parser.add_argument('-o', '--output', {
        required: true,
        type: fs.createWriteStream,
    });
    parser.add_argument('-l', '--locale', {
        required: false,
        default: 'en-US',
        help: `BGP 47 locale tag of the natural language being processed (defaults to en-US).`
    });
    parser.add_argument('--thingpedia', {
        required: true,
        help: 'Path to ThingTalk file containing class definitions.'
    });
    parser.add_argument('--entities', {
        required: true,
        help: 'Path to JSON file containing entity type definitions.'
    });
    parser.add_argument('--dataset', {
        required: true,
        help: 'Path to file containing primitive templates, in ThingTalk syntax.'
    });
    parser.add_argument('--database-file', {
        required: false,
        help: `Path to a file pointing to JSON databases used to simulate queries.`,
    });
    parser.add_argument('input_file', {
        nargs: '+',
        type: fs.createReadStream,
        help: 'Input dialog file'
    });
}

class SimulatorStream extends Stream.Transform {
    private _simulator : ThingTalkUtils.Simulator;
    private _schemas : ThingTalk.SchemaRetriever;
    private _dialoguePolicy : DialoguePolicy;

    constructor(policy : DialoguePolicy,
                simulator : ThingTalkUtils.Simulator,
                schemas : ThingTalk.SchemaRetriever) {
        super({ objectMode : true });

        this._dialoguePolicy = policy;
        this._simulator = simulator;
        this._schemas = schemas;
    }

    async _run(dlg : ParsedDialogue) : Promise<DialogueExample> {
        const lastTurn = dlg[dlg.length-1];

        let state = null;
        if (lastTurn.context) {
            const context = await ThingTalkUtils.parse(lastTurn.context, this._schemas);
            assert(context instanceof ThingTalk.Ast.DialogueState);
            const agentTarget = await ThingTalkUtils.parse(lastTurn.agent_target!, this._schemas);
            assert(agentTarget instanceof ThingTalk.Ast.DialogueState);
            state = ThingTalkUtils.computeNewState(context, agentTarget, 'agent');
        }

        const userTarget = await ThingTalkUtils.parse(lastTurn.user_target, this._schemas);
        assert(userTarget instanceof ThingTalk.Ast.DialogueState);
        state = ThingTalkUtils.computeNewState(state, userTarget, 'user');

        const { newDialogueState } = await this._simulator.execute(state, undefined);
        state = newDialogueState;

        const newTurn : DialogueTurn = {
            context: state.prettyprint(),
            agent: '',
            agent_target: '',
            intermediate_context: '',
            user: '',
            user_target: ''
        };

        const policyResult = await this._dialoguePolicy.chooseAction(state);
        if (!policyResult)
            throw new Error(`Dialogue policy error: no reply for dialogue ${dlg.id}`);
        const [dialogueStateAfterAgent, , utterance] = policyResult;

        const prediction = ThingTalkUtils.computePrediction(state, dialogueStateAfterAgent, 'agent');
        newTurn.agent = utterance;
        newTurn.agent_target = prediction.prettyprint();

        return {
            id: dlg.id,
            turns: dlg.concat([newTurn])
        };
    }

    _transform(dlg : ParsedDialogue, encoding : BufferEncoding, callback : (err : Error|null, dlg ?: DialogueExample) => void) {
        this._run(dlg).then((dlg) => callback(null, dlg), callback);
    }

    _flush(callback : () => void) {
        callback();
    }
}

export async function execute(args : any) {
    const tpClient = new Tp.FileClient(args);
    const schemas = new ThingTalk.SchemaRetriever(tpClient, null, true);

    const simulatorOptions : ThingTalkUtils.SimulatorOptions = {
        rng: seedrandom.alea('almond is awesome'),
        locale: args.locale,
        thingpediaClient: tpClient,
        schemaRetriever: schemas,
        interactive: true
    };
    if (args.database_file) {
        const database = new MultiJSONDatabase(args.database_file);
        await database.load();
        simulatorOptions.database = database;
    }
    const simulator = ThingTalkUtils.createSimulator(simulatorOptions);
    const policy = new DialoguePolicy({
        thingpedia: tpClient,
        schemas: schemas,
        locale: args.locale,
        rng: simulatorOptions.rng,
        debug: false
    });

    await StreamUtils.waitFinish(
        readAllLines(args.input_file, '====')
        .pipe(new DialogueParser())
        .pipe(new SimulatorStream(policy, simulator, schemas))
        .pipe(new DialogueSerializer())
        .pipe(args.output)
    );
}
