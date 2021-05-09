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
//         Sina Semnani <sinaj@cs.stanford.edu>

import assert from 'assert';
import * as Stream from 'stream';
import seedrandom from 'seedrandom';
import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';
import * as util from 'util';
import { Ast } from 'thingtalk';

import * as random from '../../lib/utils/random';
import * as ThingTalkUtils from '../../lib/utils/thingtalk';
import {
    ParsedDialogue,
    DialogueTurn,
    DialogueExample,
} from '../../lib/dataset-tools/parsers';
import DialoguePolicy from '../../lib/dialogue-agent/dialogue_policy';
import * as ParserClient from '../../lib/prediction/parserclient';
import * as I18n from '../../lib/i18n';

import MultiJSONDatabase from '../lib/multi_json_database';
import { PredictionResult } from '../../lib/prediction/parserclient';
import FileThingpediaClient from '../lib/file_thingpedia_client';

function changeArgumentName(expression : Ast.AtomBooleanExpression, schema : Ast.FunctionDef, rng : () => number) {
    const currentName = expression.name;
    const possibleNewNames = schema.args.filter((value) => value !== currentName); // returns a new array
    console.log('currentName = ', currentName);
    console.log('possibleNewNames = ', possibleNewNames);
    const newName = random.uniform(possibleNewNames, rng);
    expression.name = newName;
}

function changeArgumentValue(expression : Ast.AtomBooleanExpression, schema : Ast.FunctionDef, rng : () => number) {
    const currentValue = expression.value;
    // const possibleNewValues = schema.args.filter((value) => value !== currentValue); // returns a new array
    console.log('currentValue = ', currentValue);
    for (const a of schema.iterateArguments())
        console.log('iterateArguments = ', a);
    // console.log('possibleNewValues = ', possibleNewValues);
    // const newName = random.uniform(possibleNewNames, rng);
    // expression.name = newName;
}

function recursiveErrorFunction(node : Ast.Node, schema : Ast.FunctionDef, rng : () => number) {
    console.log('recursiveErrorFunction() called with node "', node.prettyprint(), '": ', util.inspect(node, false, 1, true));
    if (node instanceof Ast.AtomBooleanExpression) {
        if (random.coin(0.5, rng))
            changeArgumentValue(node, schema, rng);
        else
            changeArgumentName(node, schema, rng);
    }
    else if (node instanceof Ast.FilterExpression) {
        recursiveErrorFunction(node.expression, schema, rng);
        recursiveErrorFunction(node.filter, schema, rng);
    }
    else if (node instanceof Ast.InvocationExpression) {
        recursiveErrorFunction(node.invocation, schema, rng);
    }
    else if (node instanceof Ast.Invocation) {
        for (let i = 0 ; i < node.in_params.length ; i ++)
        recursiveErrorFunction(node.in_params[i], schema, rng);
    }
    else if (node instanceof Ast.AndBooleanExpression) {
        for (let i = 0; i < node.operands.length; i++)
            recursiveErrorFunction(node.operands[i], schema, rng);
        // recursiveErrorFunction(node.expression, schema, rng);
    }
}

function introduceErrorsToUserTarget(userTarget : Ast.DialogueState) : Ast.DialogueState {
    const rng = seedrandom.alea('almond is awesome');
    const expressions = userTarget.history[userTarget.history.length-1].stmt.expression.expressions;
    console.log(util.inspect(expressions, false, 2, true));
    for (let i=0 ; i < expressions.length ; i++) {
        const expression = expressions[i];
        const schema = expression.schema;
        // console.log('FilterExpression detected:');
        // console.log('Schema = ', util.inspect(schema!.args, false, 2, true));
        console.log('expression before = ', expression.prettyprint());
        recursiveErrorFunction(expression, schema!, rng);
        console.log('expression after = ', expression.prettyprint());
        console.log('----------');

    }
    return userTarget.clone();
}

class SimulatorStream extends Stream.Transform {
    private _simulator : ThingTalkUtils.Simulator;
    private _schemas : ThingTalk.SchemaRetriever;
    private _dialoguePolicy : DialoguePolicy;
    private _parser : ParserClient.ParserClient | null;
    private _tpClient : Tp.BaseClient;
    private _outputMistakesOnly : boolean;
    private _introduceErrors : boolean;
    private _locale : string;
    private _langPack : I18n.LanguagePack;
    private _detokenizeAll : boolean;
    private _debug : boolean;
    private _abortOnError : boolean;

    constructor(options : {
        policy : DialoguePolicy,
        simulator : ThingTalkUtils.Simulator,
        schemas : ThingTalk.SchemaRetriever,
        parser : ParserClient.ParserClient | null,
        tpClient : Tp.BaseClient,
        outputMistakesOnly : boolean,
        introduceErrors : boolean,
        detokenizeAll : boolean,
        debug : boolean,
        abortOnError : boolean,
        locale : string
    }) {
        super({ objectMode : true });

        this._dialoguePolicy = options.policy;
        this._simulator = options.simulator;
        this._schemas = options.schemas;
        this._parser = options.parser;
        this._tpClient = options.tpClient;
        this._outputMistakesOnly = options.outputMistakesOnly;
        this._introduceErrors = options.introduceErrors;
        this._detokenizeAll = options.detokenizeAll;
        this._debug = options.debug;
        this._abortOnError = options.abortOnError;
        this._locale = options.locale;
        this._langPack = I18n.get(options.locale);
    }

    _detokenize(sentence : string) : string{
        // TODO move to languagePack
        const tokens = sentence.split(' ');
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            if (this._langPack.MUST_CAPITALIZE_TOKEN.has(token))
                tokens[i] = tokens[i][0].toUpperCase() + tokens[i].substring(1);
        }
        sentence = this._langPack.detokenizeSentence(tokens);
        sentence = sentence.replace(/(^|[.?!] )([a-z])/g, (_, prefix, letter) => prefix + letter.toUpperCase());
        sentence = sentence.replace(/\s+/g, ' ');
        return sentence;
    }

    async _run(dlg : ParsedDialogue) : Promise<void> {
        console.log('dialogue = ', dlg.id);
        const lastTurn = dlg[dlg.length-1];

        let state = null;
        let contextCode, contextEntities;
        if (lastTurn.context) {
            const context = await ThingTalkUtils.parse(lastTurn.context, this._schemas);
            assert(context instanceof Ast.DialogueState);
            const agentTarget = await ThingTalkUtils.parse(lastTurn.agent_target!, this._schemas);
            assert(agentTarget instanceof Ast.DialogueState);
            state = ThingTalkUtils.computeNewState(context, agentTarget, 'agent');
            [contextCode, contextEntities] = ThingTalkUtils.serializeNormalized(ThingTalkUtils.prepareContextForPrediction(state, 'user'));
        } else {
            contextCode = ['null'];
            contextEntities = {};
        }

        let userTarget : Ast.DialogueState;
        const goldUserTarget = await ThingTalkUtils.parse(lastTurn.user_target, this._schemas);
        assert(goldUserTarget instanceof Ast.DialogueState);
        if (goldUserTarget.dialogueAct === 'invalid') {
            console.log(`${dlg.id} uses an invalid dialogue act, skipping`);
            return;
        }

        if (this._parser !== null) {
            const parsed : PredictionResult = await this._parser.sendUtterance(lastTurn.user, contextCode, contextEntities, {
                tokenized: true,
                skip_typechecking: true
            });

            const candidates = await ThingTalkUtils.parseAllPredictions(parsed.candidates, parsed.entities, {
                thingpediaClient: this._tpClient,
                schemaRetriever: this._schemas,
                loadMetadata: true
            }) as Ast.DialogueState[];

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

            if (normalizedUserTarget === normalizedGoldUserTarget && this._outputMistakesOnly) {
                // don't push anything
                return;
            } else {
                console.log('normalizedUserTarget = ', normalizedUserTarget);
                console.log('normalizedGoldUserTarget = ', normalizedGoldUserTarget);
            }
            dlg[dlg.length-1].user_target = normalizedUserTarget;

        } else {
            userTarget = goldUserTarget;
        }
        if (this._introduceErrors)
            userTarget = introduceErrorsToUserTarget(<Ast.DialogueState> userTarget);

        state = ThingTalkUtils.computeNewState(state, <Ast.DialogueState> userTarget, 'user');

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
            // console.log('policyResult = ', policyResult);
        } catch(error) {
            if (this._debug || this._abortOnError)
                throw error;
            console.log(`Error while choosing action: ${error.message}. skipping.`);
            return;
        }
        if (!policyResult) {
            if (this._debug || this._abortOnError) {
                console.log(lastTurn);
                throw new Error(`Dialogue policy error: no reply for dialogue ${dlg.id}`);
            }
            console.log(`Dialogue policy error: no reply for dialogue ${dlg.id}. skipping.`);
            console.log(lastTurn);
            return;
        }

        let utterance = policyResult.utterance;
        utterance = this._langPack.postprocessNLG(policyResult.utterance, policyResult.entities, this._simulator);
        if (this._detokenizeAll) {
            for (let i = 0 ; i < dlg.length ; i++) {
                dlg[i].agent = this._detokenize(dlg[i].agent!);
                dlg[i].user = this._detokenize(dlg[i].user!);
            }
        }

        const prediction = ThingTalkUtils.computePrediction(state, policyResult.state, 'agent');
        newTurn.agent = utterance;
        newTurn.agent_target = prediction.prettyprint();
        this.push({
            id: dlg.id,
            turns: dlg.concat([newTurn])
        });
    }

    _transform(dlg : ParsedDialogue, encoding : BufferEncoding, callback : (err : Error|null, dlg ?: DialogueExample) => void) {
        this._run(dlg).then(() => callback(null), (err) => callback(new Error(`Failed in dialogue ${dlg.id}: ${err.message}`)));
    }

    _flush(callback : () => void) {
        callback();
    }
}

export default async function worker(args : any, shard : string) {
    const tpClient = new FileThingpediaClient(args);
    const schemas = new ThingTalk.SchemaRetriever(tpClient, null, true);

    const simulatorOptions : ThingTalkUtils.SimulatorOptions = {
        rng: seedrandom.alea(args.random_seed),
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
        debug: args.debug ? 2 : 0,
        anonymous: false,
        extraFlags: {
            verboseagent: args.verbose_agent,
            ...args.flags
        },
    });

    let parser : ParserClient.ParserClient|null = null;
    if (args.nlu_server) {
        parser = ParserClient.get(args.nlu_server, args.locale);
        await parser.start();
    }

    const stream = new SimulatorStream({
        policy, simulator, schemas, parser, tpClient,
        outputMistakesOnly: args.output_mistakes_only,
        locale: args.locale,
        introduceErrors: args.introduce_errors,
        debug: args.debug,
        detokenizeAll: args.detokenize_all,
        abortOnError: args.abort_on_error
    });

    stream.on('end', () => {
        if (parser !== null)
            parser.stop();
    });

    return stream;
}
