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
import * as Tp from 'thingpedia';
import { Ast, SchemaRetriever } from 'thingtalk';

import * as ParserClient from '../prediction/parserclient';
import * as ThingTalkUtils from '../utils/thingtalk';
import { EntityMap } from '../utils/entity-utils';
import { LogLevel } from '../sentence-generator/runtime';
import ValueCategory from '../dialogue-runtime/value-category';
import { UserInput, } from '../dialogue-runtime/user-input';

import {
    CommandAnalysisType,
} from '../dialogue-runtime/dialogue-loop';
import {
    PolicyModule,
} from './policy';
import InferenceTimeSentenceGenerator from './inference-sentence-generator';


export async function inputToDialogueState(policy : PolicyModule,
                                           context : Ast.DialogueState|null,
                                           input : Ast.Input,
                                           generator : InferenceTimeSentenceGenerator) : Promise<Ast.DialogueState|null> {
    if (input instanceof Ast.ControlCommand) {
        if (input.intent instanceof Ast.SpecialControlIntent) {
            switch (input.intent.type) {
            case 'yes':
            case 'no': {
                if (context === null)
                    return null;
                const value = new Ast.BooleanValue(input.intent.type === 'yes');
                await generator.initialize(context);
                if (!policy.interpretAnswer)
                    return null;
                return policy.interpretAnswer(context, value, generator.tpLoader, generator.contextTable);
            }
            case 'nevermind':
            case 'stop':
                return new Ast.DialogueState(null, 'org.thingpedia.dialogue.transaction', 'cancel', null, []);
            case 'wakeup':
                return new Ast.DialogueState(null, 'org.thingpedia.dialogue.transaction', 'greet', null, []);
            default:
                return null;
            }
        }
        if (input.intent instanceof Ast.ChoiceControlIntent)
            return null;
        if (context === null)
            return null;

        if (input.intent instanceof Ast.AnswerControlIntent) {
            await generator.initialize(context);
            if (!policy.interpretAnswer)
                return null;
            return policy.interpretAnswer(context, input.intent.value, generator.tpLoader, generator.contextTable);
        }

        throw new TypeError(`Unrecognized bookkeeping intent`);
    } else if (input instanceof Ast.Program) {
        // convert thingtalk programs to dialogue states so we can use "\t" without too much typing
        const prediction = new Ast.DialogueState(null, 'org.thingpedia.dialogue.transaction', 'execute', null, []);
        for (const stmt of input.statements) {
            if (stmt instanceof Ast.Assignment)
                throw new Error(`Unsupported: assignment statement`);
            prediction.history.push(new Ast.DialogueHistoryItem(null, stmt, null, 'accepted'));
        }
        return prediction;
    }

    assert(input instanceof Ast.DialogueState);
    return input;
}

// Confidence thresholds:
//
// The API returns a global "intent" score associated with
// the utterance, with three components:
// "command", "ignore", "other"
// It also returns a confidence score on each candidate parse.
//
// (See LocalParserClient for how these scores are computed
// from the raw confidence scores produced by genienlp)
//
// - If the "command" component of the "intent" score is not the
//   highest of the three components, or or if we failed to parse,
//   this command is definitely out of domain.
//   We'll ship it to other backends or fail.
//
// - If we have a best valid parse, and the confidence of that parse
//   is greater than CONFIDENCE_CONFIRM_THRESHOLD, we run the command
//   without further confirmation.
//
// - If we have a best valid parse, and the confidence of that parse
//   is lower than CONFIDENCE_CONFIRM_THRESHOLD, we ship the command
//   to other backends if they are confident, or ask the user
//   for additional confirmation before executing.
const CONFIDENCE_CONFIRM_THRESHOLD = 0.5;

/**
 * Extends {@link Tp.DialogueHandler.CommandAnalysisType} with ThingTalk-specific
 * information.
 */
export interface ThingTalkCommandAnalysisType {
    type : CommandAnalysisType;
    utterance : string;
    user_target : string;

    // not null if this command was generated as a ThingTalk $answer()
    // only used by legacy ask() methods
    answer : Ast.Value|number|null;

    // the user target
    parsed : Ast.Input;
}

/**
 * Wrapper over a {@link ParserClient.ParserClient} that handles confidence
 * and also recognizes all the different ThingTalk special command types.
 */
export class CommandParser {
    private readonly _locale : string;
    private readonly _timezone : string;
    private readonly _thingpedia : Tp.BaseClient;
    private readonly _schemas : SchemaRetriever;
    private readonly _policy : PolicyModule;
    private readonly _generator : InferenceTimeSentenceGenerator;
    private readonly _nlu : ParserClient.ParserClient;
    private readonly _debug : number;
    private readonly _useConfidence : boolean;

    constructor(options : {
        locale : string;
        timezone : string;
        thingpediaClient : Tp.BaseClient,
        schemaRetriever : SchemaRetriever,
        generator : InferenceTimeSentenceGenerator,
        nlu : ParserClient.ParserClient,
        policy : PolicyModule,
        useConfidence : boolean,
        debug : number,
    }) {
        this._locale = options.locale;
        this._timezone = options.timezone;
        this._nlu = options.nlu;
        this._policy = options.policy;
        this._generator = options.generator;
        this._thingpedia = options.thingpediaClient;
        this._schemas = options.schemaRetriever;
        this._debug = options.debug;
        this._useConfidence = options.useConfidence;
    }

    private _checkPolicy(policyName : string) {
        if (policyName !== this._policy.MANIFEST.name) {
            // TODO we should download the policy from Thingpedia
            throw new Error(`Invalid dialogue policy ${policyName}`);
        }
    }

    private _getSpecialThingTalkType(input : Ast.Input) : CommandAnalysisType {
        if (input instanceof Ast.ControlCommand) {
            if (input.intent instanceof Ast.SpecialControlIntent) {
                switch (input.intent.type) {
                case 'stop':
                    return CommandAnalysisType.STOP;
                case 'debug':
                    return CommandAnalysisType.DEBUG;
                case 'failed':
                case 'ood':
                    return CommandAnalysisType.OUT_OF_DOMAIN_COMMAND;
                }
            }

            if (input.intent instanceof Ast.AnswerControlIntent)
                return CommandAnalysisType.CONFIDENT_IN_DOMAIN_FOLLOWUP;
        }

        // anything else is automatically in-domain
        return CommandAnalysisType.CONFIDENT_IN_DOMAIN_COMMAND;
    }

    prepareContextForPrediction(state : Ast.DialogueState|null) : [string[], EntityMap] {
        const prepared = ThingTalkUtils.prepareContextForPrediction(state, 'user');
        return ThingTalkUtils.serializeNormalized(prepared);
    }

    private _maybeGetThingTalkAnswer(input : Ast.Input) : Ast.Value|number|null {
        if (input instanceof Ast.ControlCommand) {
            if (input.intent instanceof Ast.SpecialControlIntent) {
                switch (input.intent.type) {
                case 'yes':
                case 'no':
                    return new Ast.Value.Boolean(input.intent.type === 'yes');
                }
            } else if (input.intent instanceof Ast.AnswerControlIntent
                       || input.intent instanceof Ast.ChoiceControlIntent) {
                return input.intent.value;
            }
        }
        return null;
    }

    /**
     * Parse a command into a ThingTalk dialogue state.
     *
     * Command is first parsed into a ThingTalk input (a dialogue state, program, or special command).
     * Then confidence is applied, and finally, the ThingTalk input is converted to a dialogue state.
     *
     * If `command` is already ThingTalk, only the conversion to a dialogue state occurs.
     *
     * @param state the current state of the dialogue before the user speaks
     * @param command the raw command from the user
     * @returns the result of analyzing the command
     */
    async parse(state : Ast.DialogueState|null, command : UserInput, options : {
        raw : boolean,
        expecting : ValueCategory|null,
        choices : string[]
    }) : Promise<ThingTalkCommandAnalysisType> {
        const analysis = await this._parseCommand(state, command, options);

        if (analysis.type === CommandAnalysisType.DEBUG || analysis.type === CommandAnalysisType.STOP)
            return analysis;

        // convert to dialogue state, if not already

        const prediction = await inputToDialogueState(this._policy, state, analysis.parsed, this._generator);
        if (prediction === null) {
            analysis.type = CommandAnalysisType.OUT_OF_DOMAIN_COMMAND;
            return analysis;
        }
        this._checkPolicy(prediction.policy);

        return {
            type: analysis.type,
            utterance: analysis.utterance,
            user_target: prediction.prettyprint(),
            answer: analysis.answer,
            parsed: prediction,
        };
    }

    async _parseCommand(state : Ast.DialogueState|null, command : UserInput, options : {
        raw : boolean,
        expecting : ValueCategory|null,
        choices : string[]
    }) : Promise<ThingTalkCommandAnalysisType> {
        if (command.type === 'thingtalk') {
            const type = this._getSpecialThingTalkType(command.parsed);
            return {
                type,
                utterance: `\\t ${command.parsed.prettyprint()}`,
                user_target: command.parsed.prettyprint(),
                answer: this._maybeGetThingTalkAnswer(command.parsed),
                parsed: command.parsed,
            };
        }

        // ok so this was a natural language

        const [contextCode, contextEntities] = this.prepareContextForPrediction(state);
        if (options.raw) {
            // in "raw mode", all natural language becomes an answer

            // we still ship it to the parser so it gets recorded
            await this._nlu.sendUtterance(command.utterance, contextCode, contextEntities, {
                expect: options.expecting ? ValueCategory[options.expecting] : undefined,
                choices: options.choices,
            });

            let value;
            if (options.expecting === ValueCategory.Location)
                value = new Ast.LocationValue(new Ast.UnresolvedLocation(command.utterance));
            else
                value = new Ast.Value.String(command.utterance);

            const parsed = new Ast.ControlCommand(null, new Ast.AnswerControlIntent(null, value));
            return {
                type: CommandAnalysisType.CONFIDENT_IN_DOMAIN_FOLLOWUP,
                utterance: command.utterance,
                user_target: parsed.prettyprint(),
                answer: value,
                parsed: parsed,
            };
        }

        // alright, let's ask parser first then
        const nluResult = await this._nlu.sendUtterance(command.utterance, contextCode, contextEntities, {
            expect: options.expecting ? ValueCategory[options.expecting] : undefined,
            choices: options.choices,
        });

        if (this._useConfidence &&
            (nluResult.intent.command < nluResult.intent.ignore ||
             nluResult.intent.command < nluResult.intent.other)) {
            if (this._debug >= LogLevel.INFO)
                console.log('ThingTalk confidence analyzed as out-of-domain command');
            const parsed = new Ast.ControlCommand(null, new Ast.SpecialControlIntent(null, 'ood'));
            return {
                type: CommandAnalysisType.OUT_OF_DOMAIN_COMMAND,
                utterance: command.utterance,
                user_target: parsed.prettyprint(),
                answer: null,
                parsed: parsed,
            };
        }

        // parse all code sequences into an Intent
        // this will correctly filter out anything that does not parse
        const candidates = await Promise.all(nluResult.candidates.map(async (candidate, beamposition) => {
            let parsed;
            try {
                parsed = await ThingTalkUtils.parsePrediction(candidate.code, nluResult.entities, {
                    locale: this._locale,
                    timezone: this._timezone,
                    thingpediaClient: this._thingpedia,
                    schemaRetriever: this._schemas,
                    loadMetadata: true,
                }, true);
            } catch(e) {
                // Likely, a type error in the ThingTalk code; not a big deal, but we still log it
                console.log(`Failed to parse beam ${beamposition}: ${e.message}`);
                parsed = new Ast.ControlCommand(null, new Ast.SpecialControlIntent(null, 'failed'));
            }
            return { parsed, score: candidate.score };
        }));
        // ensure that we always have at least one candidate by pushing $failed at the end
        candidates.push({ parsed: new Ast.ControlCommand(null, new Ast.SpecialControlIntent(null, 'failed')), score: 0 });

        // ignore all candidates with score==Infinity that we failed to parse
        // (these are exact matches that correspond to skills not available for
        // this user)
        let i = 0;
        let choice = candidates[i];
        let type = this._getSpecialThingTalkType(choice.parsed);
        while (i < candidates.length-1 && type === CommandAnalysisType.OUT_OF_DOMAIN_COMMAND && choice.score === 'Infinity') {
            i++;
            choice = candidates[i];
            type = this._getSpecialThingTalkType(choice.parsed);
        }

        if (type === CommandAnalysisType.OUT_OF_DOMAIN_COMMAND) {
            type = CommandAnalysisType.OUT_OF_DOMAIN_COMMAND;
            if (this._debug >= LogLevel.INFO)
                console.log('Failed to analyze message as ThingTalk');
            //this._loop.conversation.stats.hit('sabrina-failure');
        } else if (this._useConfidence && choice.score < CONFIDENCE_CONFIRM_THRESHOLD) {
            type = CommandAnalysisType.NONCONFIDENT_IN_DOMAIN_COMMAND;
            if (this._debug >= LogLevel.INFO)
                console.log('Dubiously analyzed message into ' + choice.parsed.prettyprint());
            //this._loop.conversation.stats.hit('sabrina-command-maybe');
        } else {
            if (this._debug >= LogLevel.INFO)
                console.log('Confidently analyzed message into ' + choice.parsed.prettyprint());
            //this._loop.conversation.stats.hit('sabrina-command-good');
        }

        // everything else is an in-domain command
        return {
            type,
            utterance: command.utterance,
            user_target: choice.parsed.prettyprint(),
            answer: this._maybeGetThingTalkAnswer(choice.parsed),
            parsed: choice.parsed,
        };
    }
}
