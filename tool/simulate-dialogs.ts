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
import * as ParserClient from '../lib/prediction/parserclient';

import { readAllLines } from './lib/argutils';
import MultiJSONDatabase from './lib/multi_json_database';
import { PredictionResult } from '../lib/prediction/parserclient';

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
    parser.add_argument('--timezone', {
        required: false,
        default: undefined,
        help: `Timezone to use to print dates and times (defaults to the current timezone).`
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
    parser.add_argument('--nlu-server', {
        required: false,
        help: `The URL of the natural language server to parse user utterances. Use a file:// URL pointing to a model directory to use a local instance of genienlp.
               If provided, will be used to parse the last user utterance instead of reading the parse from input_file.`
    });
    parser.add_argument('--output-mistakes-only', {
        action: 'store_true',
        help: 'If set and --nlu-server is provided, will only output partial dialogues where a parsing mistake happens.',
        default: false
    });
    parser.add_argument('--all-turns', {
        action: 'store_true',
        help: `If set, will run simulation on all dialogue turns as opposed to only the last turn (but still for one turn only).
        The output will have as many partial dialogues as there are dialogue turns in the input.`,
        default: false
    });
}

class SimulatorStream extends Stream.Transform {
    private _simulator : ThingTalkUtils.Simulator;
    private _schemas : ThingTalk.SchemaRetriever;
    private _dialoguePolicy : DialoguePolicy;
    private _parser : ParserClient.ParserClient | null;
    private _tpClient : Tp.BaseClient;
    private _outputMistakesOnly : boolean;
    private _locale : string;

    constructor(policy : DialoguePolicy,
                simulator : ThingTalkUtils.Simulator,
                schemas : ThingTalk.SchemaRetriever,
                parser : ParserClient.ParserClient | null,
                tpClient : Tp.BaseClient,
                outputMistakesOnly : boolean,
                locale : string) {
        super({ objectMode : true });

        this._dialoguePolicy = policy;
        this._simulator = simulator;
        this._schemas = schemas;
        this._parser = parser;
        this._tpClient = tpClient;
        this._outputMistakesOnly = outputMistakesOnly;
        this._locale = locale;
    }

    async _run(dlg : ParsedDialogue) : Promise<void> {
        console.log('dialogue = ', dlg.id);
        const lastTurn = dlg[dlg.length-1];

        let state = null;
        let contextCode, contextEntities;
        if (lastTurn.context) {
            const context = await ThingTalkUtils.parse(lastTurn.context, this._schemas);
            assert(context instanceof ThingTalk.Ast.DialogueState);
            const agentTarget = await ThingTalkUtils.parse(lastTurn.agent_target!, this._schemas);
            assert(agentTarget instanceof ThingTalk.Ast.DialogueState);
            state = ThingTalkUtils.computeNewState(context, agentTarget, 'agent');
            [contextCode, contextEntities] = ThingTalkUtils.serializeNormalized(ThingTalkUtils.prepareContextForPrediction(state, 'user'));
        } else {
            contextCode = ['null'];
            contextEntities = {};
        }

        let userTarget : ThingTalk.Ast.Input;
        const goldUserTarget = await ThingTalkUtils.parse(lastTurn.user_target, this._schemas);
        if (this._parser !== null) {
            const parsed : PredictionResult = await this._parser.sendUtterance(lastTurn.user, contextCode, contextEntities, {
                tokenized: false,
                skip_typechecking: true
            });
            
            const candidates = await ThingTalkUtils.parseAllPredictions(parsed.candidates, parsed.entities, {
                thingpediaClient: this._tpClient,
                schemaRetriever: this._schemas,
                loadMetadata: true
            }) as ThingTalk.Ast.DialogueState[];
    
            if (candidates.length > 0) {
                userTarget = candidates[0];
            } else {
                console.log(`No valid candidate parses for this command. Top candidate was ${parsed.candidates[0].code.join(' ')}. Using the gold UT`);
                userTarget = goldUserTarget;
            }
            const normalizedUserTarget : string = ThingTalkUtils.serializePrediction(userTarget, parsed.tokens, parsed.entities, {
                locale: this._locale,
                ignoreSentence: true
            }).join(' ');
            const normalizedGoldUserTarget : string = ThingTalkUtils.serializePrediction(goldUserTarget, parsed.tokens, parsed.entities, {
                locale: this._locale,
                ignoreSentence: true
            }).join(' ');

            // console.log('normalizedUserTarget = ', normalizedUserTarget)
            // console.log('normalizedGoldUserTarget = ', normalizedGoldUserTarget)

            if (normalizedUserTarget === normalizedGoldUserTarget && this._outputMistakesOnly) {
                // don't push anything
                return;
            }
            dlg[dlg.length-1].user_target = normalizedUserTarget;
            
        } else {
            userTarget = goldUserTarget;
        }
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

        let policyResult;
        try {
            policyResult = await this._dialoguePolicy.chooseAction(state);
        } catch(error) {
            console.log(`Error while choosing action: ${error.message}. skipping.`);
            return;
        }
        if (!policyResult) {
            // throw new Error(`Dialogue policy error: no reply for dialogue ${dlg.id}`);
            console.log(`Dialogue policy error: no reply for dialogue ${dlg.id}. skipping.`);
            return;
        }
        const [dialogueStateAfterAgent, , utterance] = policyResult;

        const prediction = ThingTalkUtils.computePrediction(state, dialogueStateAfterAgent, 'agent');
        newTurn.agent = utterance;
        newTurn.agent_target = prediction.prettyprint();
        this.push({
            id: dlg.id,
            turns: dlg.concat([newTurn])
        });
    }

    _transform(dlg : ParsedDialogue, encoding : BufferEncoding, callback : (err : Error|null, dlg ?: DialogueExample) => void) {
        this._run(dlg).then(() => callback(null), callback);
    }

    _flush(callback : () => void) {
        callback();
    }
}

class DialogueToPartialDialoguesStream extends Stream.Transform {

    constructor() {
        super({ objectMode : true });
    }

    private _copyDialogueTurns(turns : DialogueTurn[]) : DialogueTurn[] {
        const copy : DialogueTurn[] = [];
        for (let i = 0; i < turns.length; i++) {
            copy.push({
                context : turns[i].context,
                agent : turns[i].agent,
                agent_target : turns[i].agent_target,
                intermediate_context : turns[i].intermediate_context,
                user : turns[i].user,
                user_target : turns[i].user_target
            });
        }
        return copy;
    }

    async _run(dlg : ParsedDialogue) : Promise<void> {
        for (let i = 1; i < dlg.length + 1; i++) {
            // do a deep copy so that later streams can modify these dialogues
            const output = this._copyDialogueTurns(dlg.slice(0, i));
            (output as ParsedDialogue).id = dlg.id + '-turn_' + i;
            this.push(output);
        }
    }

    _transform(dlg : ParsedDialogue, encoding : BufferEncoding, callback : (err : Error|null, dlgs ?: ParsedDialogue) => void) {
        this._run(dlg).then(() => callback(null), callback);
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
        timezone: args.timezone,
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
        timezone: args.timezone,
        rng: simulatorOptions.rng,
        debug: 0
    });

    let parser = null;
    if (args.nlu_server){
        parser = ParserClient.get(args.nlu_server, args.locale);
        await parser.start();
    }

    if (args.all_turns) {
        await StreamUtils.waitFinish(
            readAllLines(args.input_file, '====')
            .pipe(new DialogueParser())
            .pipe(new DialogueToPartialDialoguesStream()) // convert each dialogues to many partial dialogues
            .pipe(new SimulatorStream(policy, simulator, schemas, parser, tpClient, args.output_mistakes_only, args.locale))
            .pipe(new DialogueSerializer())
            .pipe(args.output)
        );
    } else {
        await StreamUtils.waitFinish(
            readAllLines(args.input_file, '====')
            .pipe(new DialogueParser())
            .pipe(new SimulatorStream(policy, simulator, schemas, parser, tpClient, args.output_mistakes_only, args.locale))
            .pipe(new DialogueSerializer())
            .pipe(args.output)
        );
    }


    if (parser !== null)
        await parser.stop();
}
