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
import { Ast } from 'thingtalk';


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
import { introduceErrorsToUserTarget } from '../lib/error-creation';
import { EntityMap } from '../../lib/utils/entity-utils';

let POLICY_FILE_PATH : string;
try {
    // try the path relative to our build location first (in dist/lib/dialogue-agent)
    POLICY_FILE_PATH = require.resolve('../../../languages/thingtalk/policy.yaml');
} catch(e) {
    if (e.code !== 'MODULE_NOT_FOUND')
        throw e;
    // if that fails, try the location relative to our source directory
    // (in case we're running with ts-node)
    POLICY_FILE_PATH = require.resolve('../../languages/thingtalk/policy.yaml');
}

class SimulatorStream extends Stream.Transform {
    private _simulator : ThingTalkUtils.Simulator;
    private _schemas : ThingTalk.SchemaRetriever;
    private _dialoguePolicy : DialoguePolicy;
    private _parser : ParserClient.ParserClient | null;
    private _tpClient : Tp.BaseClient;
    private _outputMistakesOnly : boolean;
    private _outputAllMistakes : boolean;
    private _introduceErrors : boolean;
    private _locale : string;
    private _langPack : I18n.LanguagePack;
    private _detokenizeAll : boolean;
    private _debug : boolean;
    private _abortOnError : boolean;
    private _rng : () => number;
    private _validator : ThingTalkUtils.StateValidator;

    constructor(options : {
        policy : DialoguePolicy,
        simulator : ThingTalkUtils.Simulator,
        schemas : ThingTalk.SchemaRetriever,
        parser : ParserClient.ParserClient | null,
        tpClient : Tp.BaseClient,
        outputMistakesOnly : boolean,
        outputAllMistakes : boolean,
        introduceErrors : boolean,
        detokenizeAll : boolean,
        debug : boolean,
        abortOnError : boolean,
        locale : string,
        rng : () => number
    }) {
        super({ objectMode : true });

        this._dialoguePolicy = options.policy;
        this._simulator = options.simulator;
        this._schemas = options.schemas;
        this._parser = options.parser;
        this._tpClient = options.tpClient;
        this._outputMistakesOnly = options.outputMistakesOnly;
        this._outputAllMistakes = options.outputAllMistakes;
        this._introduceErrors = options.introduceErrors;
        this._detokenizeAll = options.detokenizeAll;
        this._debug = options.debug;
        this._abortOnError = options.abortOnError;
        this._locale = options.locale;
        this._langPack = I18n.get(options.locale);
        this._rng = options.rng;
        this._validator = new ThingTalkUtils.StateValidator(POLICY_FILE_PATH);
    }

    async load() {
        await this._validator.load();
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
        if (lastTurn.intermediate_context) {
            const context = await ThingTalkUtils.parse(lastTurn.intermediate_context, this._schemas);
            assert(context instanceof Ast.DialogueState);
            [contextCode, contextEntities] = ThingTalkUtils.serializeNormalized(ThingTalkUtils.prepareContextForPrediction(context, 'user'));
        } else if (lastTurn.context) {
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
        let is_mistake = false; // whether the top parser output doesn't match the gold

        let currentEntities : EntityMap, utteranceTokens : string[];
        if (this._parser !== null) {
            const parsed : PredictionResult = await this._parser.sendUtterance(lastTurn.user, contextCode, contextEntities, {
                tokenized: false,
                skip_typechecking: true
            });
            currentEntities = parsed.entities;
            utteranceTokens = parsed.tokens;

            const candidates = await ThingTalkUtils.parseAllPredictions(parsed.candidates, parsed.entities, {
                thingpediaClient: this._tpClient,
                schemaRetriever: this._schemas,
                loadMetadata: true,
                validator: this._validator,
                forSide: 'user'
            }) as Ast.DialogueState[];

            if (candidates.length > 0) {
                userTarget = candidates[0];
            } else {
                console.log(`No valid candidate parses for this command. Top candidate was ${parsed.candidates[0].code.join(' ')}. Using the gold UT`);
                userTarget = goldUserTarget;
                is_mistake = true;
                if (this._outputAllMistakes)
                    return;
            }
            const normalizedGoldUserTarget = ThingTalkUtils.serializePrediction(goldUserTarget, parsed.tokens, parsed.entities, {
                locale: this._locale,
                ignoreSentence: true
            }).join(' ');
            let normalizedUserTarget = ThingTalkUtils.serializePrediction(userTarget, parsed.tokens, parsed.entities, {
                locale: this._locale,
                ignoreSentence: true
            }).join(' ');

            if (normalizedUserTarget === normalizedGoldUserTarget && !is_mistake) {
                if (this._outputMistakesOnly) {
                    // don't push anything
                    return;
                } else if (this._outputAllMistakes) {
                    let beamIdx = 1;
                    while (normalizedUserTarget === normalizedGoldUserTarget) {
                        if (beamIdx >= candidates.length) {
                            // run out of parses, skip this example
                            return;
                        }
                        userTarget = candidates[beamIdx];
                        normalizedUserTarget = ThingTalkUtils.serializePrediction(userTarget, parsed.tokens, parsed.entities, {
                            locale: this._locale,
                            ignoreSentence: true
                        }).join(' ');
                        beamIdx++;
                    }
                }
            }
            console.log('normalizedUserTarget = ', normalizedUserTarget);
            console.log('normalizedGoldUserTarget = ', normalizedGoldUserTarget);

            dlg[dlg.length-1].user_target = userTarget.prettyprint();
        } else {
            userTarget = goldUserTarget;

            const tokenized = this._langPack.getTokenizer().tokenize(lastTurn.user);
            currentEntities = tokenized.entities;
            utteranceTokens = tokenized.tokens;
        }
        let userFeedback = '';
        if (this._introduceErrors) {
            try {
                const maybeIntroducedError = introduceErrorsToUserTarget(userTarget, {
                    locale: this._locale,
                    rng: this._rng,
                    tokens: utteranceTokens,
                    currentEntities: currentEntities,
                });
                if (!maybeIntroducedError) {
                    // we couldn't generate an error for this turn
                    // don't push anything
                    return;
                }

                [userTarget, userFeedback] = maybeIntroducedError;
                console.log('userFeedback = ', userFeedback);
                dlg[dlg.length-1].user_target = userTarget.prettyprint();
            } catch(e) {
                console.error(e);
                throw e;
            }
        }

        state = ThingTalkUtils.computeNewState(state, userTarget, 'user');

        const { newDialogueState } = await this._simulator.execute(state, undefined);
        state = newDialogueState;

        const newTurn : DialogueTurn = {
            context: state.prettyprint(),
            agent: '',
            agent_target: '',
            intermediate_context: '',
            user: userFeedback,
            user_target: goldUserTarget.prettyprint()
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
        if (is_mistake)
            newTurn.agent = 'Sorry, I did not understand that.';
        else
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
        outputAllMistakes: args.output_all_mistakes,
        locale: args.locale,
        introduceErrors: args.introduce_errors,
        debug: args.debug,
        detokenizeAll: args.detokenize_all,
        abortOnError: args.abort_on_error,
        rng: simulatorOptions.rng
    });
    await stream.load();

    stream.on('end', () => {
        if (parser !== null)
            parser.stop();
    });

    return stream;
}
