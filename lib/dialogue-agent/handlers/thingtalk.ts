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
import * as ThingTalk from 'thingtalk';
import { Ast, Type, Syntax } from 'thingtalk';

import { clean } from '../../utils/misc-utils';
import { getProgramIcon } from '../../utils/icons';
import * as ThingTalkUtils from '../../utils/thingtalk';
import { EntityMap } from '../../utils/entity-utils';
import type Engine from '../../engine';
import * as ParserClient from '../../prediction/parserclient';
import * as I18n from '../../i18n';

import ValueCategory from '../value-category';
import { UserInput, } from '../user-input';
import { AgentInput, } from '../agent-input';
import { CancellationError } from '../errors';

import DialoguePolicy from '../dialogue_policy';
import CardFormatter from '../card-output/card-formatter';
import AppExecutor from '../../engine/apps/app_executor';

import ExecutionDialogueAgent from '../execution_dialogue_agent';
import {
    DialogueLoop,
    DialogueHandler,
    CommandAnalysisType,
    ReplyResult,
} from '../dialogue-loop';
import { Button } from '../card-output/format_objects';
import { Replaceable } from '../../utils/template-string';

// TODO: load the policy.yaml file instead
const POLICY_NAME = 'org.thingpedia.dialogue.transaction';
const TERMINAL_STATES = ['sys_end'];

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

export default class ThingTalkDialogueHandler implements DialogueHandler<ThingTalkCommandAnalysisType, string> {
    priority = Tp.DialogueHandler.Priority.PRIMARY;
    uniqueId = 'thingtalk';

    icon : string|null = null;
    private _ : (x : string) => string;
    private _engine : Engine;
    _loop : DialogueLoop;
    private _prefs : Tp.Preferences;
    private _langPack : I18n.LanguagePack;
    private _nlu : ParserClient.ParserClient;
    private _nlg : ParserClient.ParserClient;
    private _cardFormatter : CardFormatter;

    private _agent : ExecutionDialogueAgent;
    private _policy : DialoguePolicy;
    _dialogueState : ThingTalk.Ast.DialogueState|null;
    private _executorState : undefined;

    private _debug : boolean;
    private _useConfidence : boolean;
    private _rng : () => number;
    private _ifDynamic : boolean;
    private _bypassAnswerControlIntent : boolean;

    constructor(engine : Engine,
                loop : DialogueLoop,
                agent : ExecutionDialogueAgent,
                nlu : ParserClient.ParserClient,
                nlg : ParserClient.ParserClient,
                options : { debug : boolean,
                            useConfidence : boolean,
                            rng : () => number,
                            ifDynamic : boolean}) {
        this._ = engine._;

        this._debug = options.debug;
        this._useConfidence = options.useConfidence;
        this._rng = options.rng;
        this._ifDynamic = options.ifDynamic;
        // FIXME: fix this
        this._bypassAnswerControlIntent = true;
        this._engine = engine;
        this._loop = loop;
        this._prefs = engine.platform.getSharedPreferences();

        this._langPack = I18n.get(engine.platform.locale);
        this._cardFormatter = new CardFormatter(engine.platform.locale, engine.platform.timezone, engine.schemas);

        this._agent = agent;
        this._nlu = nlu;
        this._nlg = nlg;
        this._policy = new DialoguePolicy({
            thingpedia: engine.thingpedia,
            schemas: engine.schemas,
            locale: engine.platform.locale,
            timezone: engine.platform.timezone,
            rng: loop.conversation.rng,
            debug : this._debug ? 2 : 0,
            anonymous: loop.isAnonymous,
            extraFlags: loop.conversation.dialogueFlags,
        });
        this._dialogueState = null; // thingtalk dialogue state
        this._executorState = undefined; // private object managed by DialogueExecutor
    }

    isGeniescript() : boolean {
        return false;
    }

    getState() : string {
        return this._dialogueState ? this._dialogueState.prettyprint() : 'null';
    }

    reset() : void {
        this._dialogueState = null;
    }

    private _checkPolicy(policyName : string) {
        if (policyName !== POLICY_NAME) {
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
                case 'nevermind':
                    return CommandAnalysisType.NEVERMIND;
                case 'wakeup':
                    return CommandAnalysisType.WAKEUP;
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

    private _prepareContextForPrediction(state : Ast.DialogueState|null, forSide : 'user'|'agent') : [string[], EntityMap] {
        const prepared = ThingTalkUtils.prepareContextForPrediction(state, forSide);
        return ThingTalkUtils.serializeNormalized(prepared);
    }

    prepareContextForPrediction() {
        return this._prepareContextForPrediction(this._dialogueState, 'user');
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

    async analyzeCommand(command : UserInput|AgentInput) : Promise<ThingTalkCommandAnalysisType> {
        const analysis = await this._parseCommand(command);

        if (analysis.type === CommandAnalysisType.DEBUG || analysis.type === CommandAnalysisType.STOP)
            return analysis;

        // defensive programming
        if (analysis.parsed instanceof Ast.DialogueState) {
            // do levenshtein apply, depending on whether to use dynamic resolution
            if (this._ifDynamic) {
                await handleIncomingDelta(this._dialogueState, analysis.parsed,
                    async (x) => {
                        const res = await this._agent.executeExpr(x, this._dialogueState!, this._executorState);
                        return res;
                    }
                );
            } else {
                await handleIncomingDelta(this._dialogueState, analysis.parsed, undefined);
            }

            // record the natural language utterance
            if (command.type === 'command' && command.utterance) {
                for (const i of analysis.parsed.history)
                    i.utterance = command.utterance;
            }
        }

        // convert to dialogue state, if not already

        // circumevent the function below in the special yes case
        // in this case, we put a special state $yes on the dialogue state
        // GenieScript programs have a choice of whether they are expecting this
        // Meanwhile, if anything on the dialogue state that needs to be executed, they get executed first
        // this determination is done below - in `getReply`
        if (analysis.parsed instanceof Ast.ControlCommand &&
            analysis.parsed.intent instanceof Ast.SpecialControlIntent &&
            analysis.parsed.intent.type === 'yes' &&
            this._loop.expecting !== ValueCategory.YesNo) {
            return {
                type: CommandAnalysisType.CONFIDENT_IN_DOMAIN_COMMAND,
                utterance: analysis.utterance,
                user_target: analysis.parsed.prettyprint(),
                answer: analysis.answer,
                parsed: analysis.parsed,
            };
        }

        if (analysis.parsed instanceof Ast.DialogueState && analysis.parsed.dialogueAct.includes('cancel')) {
            // speical processing floor
            const lastItem = this._dialogueState!.history[this._dialogueState!.history.length - 1].stmt;
            const table = Ast.getAllInvocationExpression(lastItem)[0] as Ast.InvocationExpression;
            const expression = lastItem.clone();
            expression.expression.expressions[0] = table;
            this._dialogueState!.history = [new Ast.DialogueHistoryItem(null, expression, null, 'confirmed', new Ast.Levenshtein(null, expression.expression, '$continue'))];
            return {
                type: CommandAnalysisType.CONFIDENT_IN_DOMAIN_COMMAND,
                utterance: analysis.utterance,
                user_target: analysis.parsed.prettyprint(),
                answer: analysis.answer,
                parsed: analysis.parsed,
            };
        }

        const prediction = await ThingTalkUtils.inputToDialogueState(this._policy, this._dialogueState, analysis.parsed);
        if (prediction === null) {
            analysis.type = CommandAnalysisType.OUT_OF_DOMAIN_COMMAND;
            return analysis;
        }

        return {
            type: analysis.type === CommandAnalysisType.NEVERMIND || analysis.type === CommandAnalysisType.WAKEUP ?
                CommandAnalysisType.CONFIDENT_IN_DOMAIN_COMMAND : analysis.type,
            utterance: analysis.utterance,
            user_target: prediction.prettyprint(),
            answer: analysis.answer,
            parsed: prediction,
        };
    }

    async _parseCommand(command : UserInput|AgentInput) : Promise<ThingTalkCommandAnalysisType> {
        if (command.type === 'userThingtalk' || command.type === 'agentThingtalk') {
            const type = this._getSpecialThingTalkType(command.parsed);
            if (command.type === 'userThingtalk') {
                return {
                    type,
                    utterance: `\\t ${command.parsed.prettyprint()}`,
                    user_target: command.parsed.prettyprint(),
                    answer: this._maybeGetThingTalkAnswer(command.parsed),
                    parsed: command.parsed,
                };
            } else {
                return {
                    type,
                    utterance: `\\t ${command.parsed.prettyprint()}`,
                    user_target: `agent_init ${command.parsed.prettyprint()}`,
                    answer: this._maybeGetThingTalkAnswer(command.parsed),
                    parsed: command.parsed,
                };
            }
        }

        // ok so this was a natural language

        const [contextCode, contextEntities] = this._prepareContextForPrediction(this._dialogueState, 'user');
        if (this._loop.raw) {
            // special case current location operator for now
            if (this._loop.expecting === ValueCategory.Location) {
                // we still ship it to the parser so it gets recorded
                await this._nlu.sendUtterance(command.utterance, contextCode, contextEntities, {
                    expect: this._loop.expecting ? ValueCategory[this._loop.expecting] : undefined,
                    choices: this._loop.choices,
                    store: this._prefs.get('sabrina-store-log') as string || 'no'
                });
                const value = new Ast.LocationValue(new Ast.UnresolvedLocation(command.utterance));
                const parsed = new Ast.ControlCommand(null, new Ast.AnswerControlIntent(null, value));
                return {
                    type: CommandAnalysisType.CONFIDENT_IN_DOMAIN_FOLLOWUP,
                    utterance: command.utterance,
                    user_target: parsed.prettyprint(),
                    answer: value,
                    parsed: parsed,
                };
            }
        }

        // alright, let's ask parser first then
        const nluResult = await this._nlu.sendUtterance(command.utterance, contextCode, contextEntities, {
            expect: this._loop.expecting ? ValueCategory[this._loop.expecting] : undefined,
            choices: this._loop.choices,
            store: this._prefs.get('sabrina-store-log') as string || 'no',
            skip_typechecking: true
        });

        if (this._useConfidence &&
            (nluResult.intent.command < nluResult.intent.ignore ||
             nluResult.intent.command < nluResult.intent.other)) {
            this._loop.debug('ThingTalk confidence analyzed as out-of-domain command');
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
        let candidates = await Promise.all(nluResult.candidates.map(async (candidate, beamposition) => {
            let parsed;
            try {
                parsed = await ThingTalkUtils.parsePrediction(candidate.code, nluResult.entities, {
                    timezone: this._engine.platform.timezone,
                    thingpediaClient: this._engine.thingpedia,
                    schemaRetriever: this._engine.schemas,
                    loadMetadata: true,
                }, true);
            } catch(e : any) {
                // Likely, a type error in the ThingTalk code; not a big deal, but we still log it
                console.log(`Failed to parse beam ${beamposition}: ${e.message}`);
                parsed = new Ast.ControlCommand(null, new Ast.SpecialControlIntent(null, 'failed'));
            }
            return { parsed, score: candidate.score };
        }));

        // if set to bypass all answer control intent ($answer ...)
        // then filter out that answer
        // such behavior is desired when direct answers may not typecheck with the current slot fill
        if (this._bypassAnswerControlIntent && candidates.length > 1) {
            const newCandidates = [];
            for (const candidate of candidates) {
                if (!(candidate.parsed instanceof Ast.ControlCommand && candidate.parsed.intent instanceof Ast.AnswerControlIntent))
                    newCandidates.push(candidate);
            }
            candidates = newCandidates;
        }


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
            this._loop.debug('Failed to analyze message as ThingTalk');
            if (nluResult.candidates.length === 0)
                this._loop.debug('No candidates produced');
            else
                this._loop.debug(`Top candidate was ${nluResult.candidates[0].code.join(' ')}`);
            this._loop.conversation.stats.hit('sabrina-failure');
        } else if (this._useConfidence && choice.score < CONFIDENCE_CONFIRM_THRESHOLD) {
            type = CommandAnalysisType.NONCONFIDENT_IN_DOMAIN_COMMAND;
            this._loop.debug('Dubiously analyzed message into ' + choice.parsed.prettyprint());
            this._loop.conversation.stats.hit('sabrina-command-maybe');
        } else {
            this._loop.debug('Confidently analyzed message into ' + choice.parsed.prettyprint());
            this._loop.conversation.stats.hit('sabrina-command-good');
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

    private ifExecutable() : boolean {
        if (!this._dialogueState) {
            this._loop.debug("ThingTalk dialogue state ifExecutable returning false because there is no dialogue state");
            return false;
        }
        
        for (let i = this._dialogueState!.history.length - 1; i >= 0 ; i--) {
            if (this._dialogueState.history[i].confirm === 'accepted') {
                this._loop.debug(`ThingTalk dialogue state ifExecutable returning true due to item ${this._dialogueState.history[i].prettyprint()}`);
                return true;
            }
        }

        this._loop.debug("ThingTalk dialogue state ifExecutable returning false after evaluation of dialogue state");
        return false;
    }

    async getReply(analyzed : ThingTalkCommandAnalysisType) : Promise<ReplyResult> {
        // if user utterance is Ack and there is no proposed items on the stack
        // because if there was a proposed item, it means that this could be right
        // after a propose, and we'd like the semantic parser to deal with it
        // NOTE: this._loop.expecting retrieves the information from the dialogue loop
        //       which was set in last turn
        if (analyzed.parsed instanceof Ast.ControlCommand &&
            analyzed.parsed.intent instanceof Ast.SpecialControlIntent &&
            analyzed.parsed.intent.type === 'yes' &&
            this._loop.expecting !== ValueCategory.YesNo) {

            // scan the dialogue state to understand whether there is anything that can be executed
            // if so, move the accepted item to the front and execute it
            // if not, hand back to dialogue looop
            if (this.ifExecutable()) {
                // if the newest one is now completed, and there is
                // more accepted ones further in the back, move those to the front
                // NOTE: we do not move proposed ones
                const newHistoryList = [];
                const newHistoryListTop = []; // this stores all the accepted ones
                const latestItem = this._dialogueState!.history[this._dialogueState!.history.length - 1];
                if (latestItem.confirm === 'confirmed') {
                    for (let i = 0; i < this._dialogueState!.history.length; i ++) {
                        if (this._dialogueState!.history[i].confirm === 'accepted')
                            newHistoryListTop.push(this._dialogueState!.history[i]);
                        else
                            newHistoryList.push(this._dialogueState!.history[i]);
                    }
                    this._dialogueState!.history = newHistoryList.concat(newHistoryListTop);

                    // set the stage for execution of statement on behalf of user
                    this._dialogueState!.dialogueAct = "execute";
                } else {
                    console.log("WARNING: user says okay, decided that there is still accepted ones on the dialogue state. Yet, the last item is confirmed");
                }
                        
                return this._executeCurrentState();
            } else {
                // in certain edge cases, _dialogueState could yet be set
                if (this._dialogueState) {
                    console.log("ThingTalk dialogue handler getReply: triggered special $yes procedure, set user is Done on the dialogue state");
                    this._dialogueState.userIsDone = true;
                }
                return {
                    messages: [],
                    context: this._dialogueState ? this._dialogueState.prettyprint() : 'null',
                    agent_target: '$dialogue @org.thingpedia.dialogue.transaction.special_yes',
                    expecting: null,
                };
            }
        }

        switch (analyzed.type) {
        case CommandAnalysisType.NONCONFIDENT_IN_DOMAIN_FOLLOWUP:
        case CommandAnalysisType.NONCONFIDENT_IN_DOMAIN_COMMAND: {
            // TODO move this to the state machine, not here
            const question = await this._makeClarificationQuestion(analyzed.parsed!);
            assert(question, `Failed to compute a description of the current command`);
            const yesNo = await this._loop.ask(ValueCategory.YesNo, question);
            assert(yesNo instanceof Ast.BooleanValue);
            if (!yesNo.value) {
                return {
                    messages: [this._("Sorry I couldn't help on that.")],
                    context: this._dialogueState ? this._dialogueState.prettyprint() : 'null',
                    agent_target: '$dialogue @org.thingpedia.dialogue.transaction.sys_clarify;',
                    expecting: null,
                };
            }

            // fallthrough to the confident case
        }

        case CommandAnalysisType.CONFIDENT_IN_DOMAIN_FOLLOWUP:
        case CommandAnalysisType.CONFIDENT_IN_DOMAIN_COMMAND:
        default: {
            return this._handleNormalDialogueCommand(analyzed.parsed as Ast.DialogueState);
        }
        }
    }

    private async _handleNormalDialogueCommand(prediction : Ast.DialogueState) : Promise<ReplyResult> {
        this._dialogueState = ThingTalkUtils.computeNewState(this._dialogueState, prediction, 'user');
        this._checkPolicy(this._dialogueState.policy);

        return this._executeCurrentState();
    }

    async getFollowUp() : Promise<ReplyResult|null> {
        if (this._dialogueState === null)
            return null;
        const followUp : Ast.DialogueState|null = await this._policy.getFollowUp(this._dialogueState);
        if (followUp === null) {
            if (this._loop.expecting === null && TERMINAL_STATES.includes(this._dialogueState.dialogueAct))
                throw new CancellationError();
            return null;
        }

        console.log('followUp', followUp.prettyprint());
        this._dialogueState = followUp;
        return this._executeCurrentState();
    }

    private async _makeClarificationQuestion(program : Ast.Input) {
        const allocator = new Syntax.SequentialEntityAllocator({}, { timezone: this._engine.platform.timezone });
        const describer = new ThingTalkUtils.Describer(this._engine.platform.locale,
            this._engine.platform.timezone,
            allocator);
        // retrieve the relevant primitive templates
        const kinds = new Set<string>();
        for (const [, prim] of program.iteratePrimitives(false))
            kinds.add(prim.selector.kind);
        for (const kind of kinds)
            describer.setDataset(kind, await this._engine.schemas.getExamplesByKind(kind));

        let description = describer.describe(program);
        if (description === null)
            return null;

        const question = Replaceable.get(this._("Did you mean ${command}?"), this._langPack, ['command']);
        description = question.replace({ constraints: {}, replacements: [{ text: description, value: description }] });
        if (description === null)
            return null;

        let utterance = description.chooseBest();
        utterance = this._langPack.postprocessSynthetic(utterance, null, this._rng, 'agent');
        return this._langPack.postprocessNLG(utterance, allocator.entities, this._agent);
    }

    private async _executeCurrentState() {
        this.icon = getProgramIcon(this._dialogueState!);

        //this.debug(`Before execution:`);
        //this.debug(this._dialogueState.prettyprint());

        const { newDialogueState, newExecutorState, newPrograms, newResults } = await this._agent.execute(this._dialogueState!, this._executorState);
        this._dialogueState = newDialogueState;
        this._executorState = newExecutorState;
        // in some TBD edge cases, there will be some history items
        // that somehow becomes undefined
        // filter them out before they cause further problems
        this._dialogueState.history = this._dialogueState.history.filter((x) => !!x);
        this._loop.debug(`Execution state:`);
        this._loop.debug(this._dialogueState.prettyprint());

        for (const newProgram of newPrograms)
            await this._loop.conversation.sendNewProgram(newProgram);

        return this._doAgentReply(newResults);
    }

    private _useNeuralNLG() : boolean {
        return this._prefs.get('experimental-use-neural-nlg') as boolean;
    }

    private async _doAgentReply(newResults : Array<[string, Record<string, unknown>]>) : Promise<ReplyResult> {
        const oldState = this._dialogueState;

        if (oldState?.dialogueAct === "not_that")
            return this.notThatHandler();


        const policyResult = await this._policy.chooseAction(this._dialogueState);
        assert(policyResult, `Failed to compute a reply`);
        this._dialogueState = policyResult.state;
        let utterance = policyResult.utterance;
        const policyPrediction = ThingTalkUtils.computePrediction(oldState, this._dialogueState, 'agent');
        const agentTarget = policyPrediction.prettyprint();

        this._loop.debug(`Agent act:`);
        this._loop.debug(agentTarget);

        if (this._useNeuralNLG()) {
            const [contextCode, contextEntities] = this._prepareContextForPrediction(this._dialogueState, 'agent');

            const [targetAct,] = ThingTalkUtils.serializeNormalized(policyPrediction, contextEntities);
            const result = await this._nlg.generateUtterance(contextCode, contextEntities, targetAct);
            utterance = result[0].answer;
        }
        utterance = this._langPack.postprocessNLG(utterance, policyResult.entities, this._agent);

        this.icon = getProgramIcon(this._dialogueState!);

        const before : Array<string|Tp.FormatObjects.FormattedObject> = [];
        const messages : Array<string|Tp.FormatObjects.FormattedObject> = [utterance];

        let result_type : string|null = "";
        const result_values : Array<Record<string, unknown>> = [];
        for (const [outputType, outputValue] of newResults.slice(0, policyResult.numResults)) {
            if (result_type === "")
                result_type = outputType;
            result_values.push(outputValue);
            const formatted = await this._cardFormatter.formatForType(outputType, outputValue);

            for (const msg of formatted) {
                if (msg.type === 'sound' && (msg as any).before)
                    before.push(msg);
                else
                    messages.push(msg);
            }
        }

        let expecting : ValueCategory|null;
        if (policyResult.end) {
            expecting = null;
        } else if (policyResult.expect instanceof Type.Enum) {
            for (const entry of policyResult.expect.entries!) {
                const button = new Button({
                    type: 'button',
                    title: clean(entry),
                    json: JSON.stringify({ code: ['$answer', '(', 'enum', entry, ')', ';'], entities: {} })
                });
                messages.push(button as any);
            }
            expecting = ValueCategory.Generic;
        } else if (policyResult.expect) {
            expecting = ValueCategory.fromType(policyResult.expect);
        } else {
            expecting = ValueCategory.Generic;
        }
        if (expecting === ValueCategory.RawString && !policyResult.raw)
            expecting = ValueCategory.Generic;

        return {
            messages: before.concat(messages),
            context: oldState ? oldState!.prettyprint() : '',
            agent_target: agentTarget,
            expecting,
            result_type: result_type,
            result_values: result_values
        };
    }

    private async _showWelcome() {
        this._dialogueState = await this._policy.getInitialState();
        if (this._dialogueState === null)
            return this._doAgentReply([]);
        else
            return this._executeCurrentState();
    }

    async initialize(initialState : string | undefined, showWelcome : boolean) : Promise<ReplyResult|null> {
        await this._policy.initialize();

        if (initialState !== undefined) {
            if (initialState === 'null') {
                this._dialogueState = null;
                return null;
            } else {
                try {
                    const parsed = await ThingTalkUtils.parse(initialState, {
                        locale: this._engine.platform.locale,
                        timezone: this._engine.platform.timezone,
                        schemaRetriever: this._engine.schemas,
                        thingpediaClient: this._engine.thingpedia
                    });
                    assert(parsed instanceof Ast.DialogueState);
                    this._dialogueState = parsed;

                    if (!this._dialogueState.dialogueAct.startsWith('sys_')) {
                        // execute the current dialogue state
                        // this will attempt to run all the programs that failed in the
                        // previous conversation (most likely because they were executed
                        // in the anonymous context)
                        // note: we need "return await" here or try/catch won't work
                        return await this._executeCurrentState();
                    } else {
                        this.icon = getProgramIcon(this._dialogueState);
                        return null;
                    }
                } catch(e : any) {
                    if (e.code === 'ECANCELLED')
                        return null;
                    console.error(`Failed to restore conversation state: ${e.message}`);
                    this._dialogueState = null;
                    return null;
                }
            }
        } else if (showWelcome) {
            try {
                // if we want to show the welcome message, we run the policy on the `null` state, which will return the sys_greet intent
                // note: we need "return await" here or try/catch won't work
                return await this._showWelcome();
            } catch(e : any) {
                if (e.code === 'ECANCELLED')
                    return null;
                console.error(`Failed to show welcome message: ${e.message}`);
                this._dialogueState = null;
                return null;
            }
        } else {
            return null;
        }
    }

    async showNotification(app : AppExecutor,
                           outputType : string,
                           outputValue : Record<string, unknown>) {
        assert(app.program.statements.length === 1);
        const stmt = app.program.statements[0];
        assert(stmt instanceof ThingTalk.Ast.ExpressionStatement);
        assert(stmt.expression.schema);

        const mappedResult = await this._agent.executor.mapResult(stmt.expression.schema, outputValue);
        this._dialogueState = await this._policy.getNotificationState(app.name, app.program, mappedResult);
        return this._doAgentReply([[outputType, outputValue]]);
    }

    async showAsyncError(app : AppExecutor,
                         error : Error) {
        console.log('Error from ' + app.uniqueId, error);

        const mappedError = await this._agent.executor.mapError(error);
        this._dialogueState = await this._policy.getAsyncErrorState(app.name, app.program, mappedError);
        return this._doAgentReply([]);
    }

    private notThatHandler() {
        const oldState = this._dialogueState!;
        const newState : Ast.DialogueState = new Ast.DialogueState(null, oldState.policy, "execute", null, oldState.history, undefined);
        if (oldState.history[oldState.history.length - 1].levenshtein === null) {
            console.log("_doAgentReply: not_that, last-turn does not have delta, set to the statement itself");
            oldState.history[oldState.history.length - 1].levenshtein = new Ast.Levenshtein(null, oldState.history[oldState.history.length - 1].stmt.expression, "$continue");
        }
        
        const delta = oldState.history[oldState.history.length - 1].levenshtein;
        let newStateItem : Ast.DialogueHistoryItem;
        let response : string;
        let agentTarget : string;
        // for now, take an ad-hoc look at the last turn delta and take out the outmost AST node
        if (delta!.expression.first instanceof Ast.ProjectionExpression) {
            newStateItem = new Ast.DialogueHistoryItem(null, new Ast.ExpressionStatement(null, delta!.expression.first.expression), null, "accepted", null, undefined);
            response = "Ok, what would you like to know?";
            agentTarget = "$dialogue @org.thingpedia.dialogue.transaction.sys_learn_more_what";
        } else if (delta!.expression.first instanceof Ast.FilterExpression && delta!.expression.first.filter instanceof Ast.AtomBooleanExpression) {
            newStateItem = new Ast.DialogueHistoryItem(null, new Ast.ExpressionStatement(null, delta!.expression.first.expression), null, "accepted", null, undefined);
            response = `Ok, what ${delta!.expression.first.filter.name} would like?`;
            agentTarget = `$dialogue @org.thingpedia.dialogue.transaction.sys_search_question(${delta!.expression.first.filter.name})`;
        } else {
            throw Error("_doAgentReply: not_that delta expression currently not supported: " + delta!.prettyprint());
        }

        newState.history.push(newStateItem);
        this._dialogueState = newState;

        // TODO: figure out expecting
        const expecting = ValueCategory.Generic;
        return {
            messages: [response],
            context: newState.prettyprint(),
            agent_target: agentTarget,
            expecting: expecting,
        };
    }
}

/**
 * Given an incoming delta expression and the old dialogue state, compute the new dialogue state.
 * This function modifies @param analysis in-place, which will be the new dialogueHistoryItem
 * corresponding to this user target.
 * 
 * The algorithm works in the following way:
 * When a new request comes in as a delta, take a look at all items on the stack.
 * Use the top related item - regardless of its status - to do apply.
 * Then, put the applied result on the top. 
 * 
 * The reason behind is that the semantic parser should have already picked up the
 * correct item in generating delta
 * 
 * @param dialogueState old dialogue state
 * @param analysis dialogue state returned by semantic parser
 */

export async function handleIncomingDelta(dialogueState : Ast.DialogueState | null, analysis : Ast.DialogueState, resolutor : undefined | ((args0 : Ast.Expression) => Promise<boolean>)) {
    if (!dialogueState)
        return;
    
    for (const item of analysis.history) {
        if (!item.levenshtein)
            continue;
        
        const deltaInv = Ast.getAllInvocationExpression(item.levenshtein);

        // if we can not find an overlapping item, directly use delta as the new expression
        // if an overlapping item is found, `applied` will be updated in the loop
        const applied = new Ast.ExpressionStatement(null, item.levenshtein.expression);

        for (let i = dialogueState.history.length - 1; i >= 0; i --) {
            const currInv = Ast.getAllInvocationExpression(dialogueState.history[i].stmt.expression.last);
            if (Ast.ifOverlap(deltaInv, currInv)) {
                const lastTurn = dialogueState.history[i].stmt;
                if (resolutor)
                    applied.expression = await Ast.applyLevenshtein(lastTurn.expression, item.levenshtein, dialogueState, resolutor);
                else
                    applied.expression = Ast.applyLevenshteinSync(lastTurn.expression, item.levenshtein, dialogueState);
                break;
            }
        }

        item.stmt = applied;
        if (!item.stmt.expression.schema)
            item.stmt.expression.schema = item.stmt.expression.last.schema;
    }
}