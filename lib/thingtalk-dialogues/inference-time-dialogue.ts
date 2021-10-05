// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020-2021 The Board of Trustees of the Leland Stanford Junior University
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
import { Ast, Type, SchemaRetriever } from 'thingtalk';
import AsyncQueue from 'consumer-queue';

import * as I18n from '../i18n';
import * as ParserClient from '../prediction/parserclient';
import * as ThingTalkUtils from '../utils/thingtalk';
import { ReplacedConcatenation, ReplacedResult } from '../utils/template-string';
import { clean } from '../utils/misc-utils';
import { getProgramIcon } from '../utils/icons';

import {
    AgentReply,
    AgentReplyRecord,
    ContextPhrase,
    Template
} from '../sentence-generator/types';
import { LogLevel } from '../sentence-generator/runtime';

import ValueCategory from '../dialogue-runtime/value-category';
import { UserInput, } from '../dialogue-runtime/user-input';
import CardFormatter from '../dialogue-runtime/card-output/card-formatter';
import {
    DialogueHandler,
    CommandAnalysisType,
    ReplyResult,
} from '../dialogue-runtime/dialogue-loop';
import { Button } from '../dialogue-runtime/card-output/format_objects';

import { DialogueInterface, } from './interface';
import {
    PolicyModule, PolicyStartMode
} from './policy';
import { Command } from './command';
import {
    AbstractCommandIO,
    SimpleCommandDispatcher,
    TerminatedDialogueError,
    UnexpectedCommandError
} from './cmd-dispatch';
import AbstractThingTalkExecutor from './abstract-thingtalk-executor';
import { CommandParser, ThingTalkCommandAnalysisType } from './command-parser';
import { load as loadPolicy } from './policy';
import InferenceTimeSentenceGenerator from './inference-sentence-generator';
import { addTemplate } from './template-utils';

type ReplacedAgentMessage = Tp.FormatObjects.FormattedObject | {
    type : 'link';
    title : string;
    url : string;
};

interface ExtendedAgentReplyRecord extends AgentReplyRecord {
    messages : ReplacedAgentMessage[];
    end : boolean;
}

interface InferenceTimeDialogueOptions {
    nlu : ParserClient.ParserClient,
    nlg : ParserClient.ParserClient,
    executor : AbstractThingTalkExecutor,
    locale : string,
    timezone : string,
    thingpediaClient : Tp.BaseClient,
    schemaRetriever : SchemaRetriever,
    policy : string|undefined,
    extraFlags : Record<string, boolean>,
    anonymous : boolean,
    useConfidence : boolean,
    debug : number,
    rng : () => number
}

/**
 * Runtime for a ThingTalk dialogue at inference time.
 *
 * This class is bridge between a {@link PolicyFunction} and the dialogue loop.
 * It exposes the {@link DialogueInterface} interface to the policy, through
 * {@link AbstractCommandIO}. It exposes the {@link DialogueHandler} interface
 * to the dialogue loop.
 *
 * The policy function runs in its own promise thread: it pulls commands from
 * this class (with {@link get}) and pushes replies on its own time (with {@link emit}).
 * The dialogue loop on the other hand expects a reply to a command in a single call to
 * {@link getRply}. This class handles the synchronization.
 */
export class InferenceTimeDialogue implements AbstractCommandIO, DialogueHandler<ThingTalkCommandAnalysisType, string> {
    priority = Tp.DialogueHandler.Priority.PRIMARY;
    uniqueId = 'thingtalk';
    icon : string|null = null;

    private readonly _options : InferenceTimeDialogueOptions;
    private readonly _thingpedia : Tp.BaseClient;
    private readonly _schemas : SchemaRetriever;
    private readonly _langPack : I18n.LanguagePack;
    private readonly _executor : AbstractThingTalkExecutor;
    private readonly _nlg : ParserClient.ParserClient;
    private _dlg ! : DialogueInterface;
    private _policy ! : PolicyModule;
    private _agentGenerator ! : InferenceTimeSentenceGenerator;
    private _nlu ! : CommandParser;
    private readonly _cardFormatter : CardFormatter;
    private readonly _debug : number;
    private readonly _flags : Record<string, boolean>;

    /**
     * Whether the dialogue is currently in raw mode (i.e. any command
     * from the user is treated as a quoted string without parsing).
     *
     * This has the same purpose as {@link DialogueLoop}.raw but it
     * only tracks the state of this agent, so it can differ when other
     * dialogue handlers are involved.
     */
    private _raw : boolean;
    /**
     * What type the current agent is expecting.
     *
     * This is used to affect the semantic parsing heuristics. It has
     * the same meaning as {@link DialogueLoop}.expecting, but it only
     * tracks the state of this agent, so it can differ when other
     * dialogue handlers are involved.
     */
    private _expecting : ValueCategory|null;
    /**
     * Multiple choices that the agent is asking the user to disambiguate.
     *
     * This is used when {@link _expecting} is {@link ValueCategory.MultipleChoice}.
     */
    private _choices : string[];

    private readonly _commandQueue : AsyncQueue<Command>;
    private _nextReply : ExtendedAgentReplyRecord|null;
    private _policyRunning = 0;
    private _continuePromise : Promise<ReplyResult>|null;
    private _continueResolve : ((reply : ReplyResult) => void)|null;

    constructor(options : InferenceTimeDialogueOptions) {
        this._options = options;
        this._thingpedia = options.thingpediaClient;
        this._schemas = options.schemaRetriever;
        this._nlg = options.nlg;
        this._langPack = I18n.get(options.locale);
        this._executor = options.executor;
        this._cardFormatter = new CardFormatter(options.locale, options.timezone, options.schemaRetriever);
        this._debug = options.debug;
        this._commandQueue = new AsyncQueue();
        this._flags = {
            dialogues: true,
            inference: true,
            anonymous: this._options.anonymous,
            ...this._options.extraFlags
        };

        this._raw = false;
        this._expecting = null;
        this._choices = [];

        this._nextReply = null;
        this._continuePromise = null;
        this._continueResolve = null;
    }

    /**
     * Low-level access to the dialogue state.
     *
     * This is used by interactive-annotate, which needs the dialogue state to run the parser.
     */
    get state() {
        return this._dlg.state;
    }

    /**
     * Low-level access to the agent generator.
     *
     * This is used by interactive-annotate, which needs to call raw policy methods to convert answers
     * to dialogue states.
     */
    get generator() {
        return this._agentGenerator;
    }

    /**
     * Low-level access to the policy.
     *
     * This is used by interactive-annotate, which needs to call raw policy methods to convert answers
     * to dialogue states.
     */
    get policy() {
        return this._policy;
    }

    /**
     * Initialize this dialogue handler.
     *
     * This method must be called before any other method is called. It can be called multiple times
     * to start the dialogue multiple times with different initial states.
     *
     * @param initialState
     * @param showWelcome
     * @returns
     */
    async initialize(initialState : string | undefined, showWelcome : boolean) : Promise<ReplyResult|null> {
        if (!this._policy)
            this._policy = await loadPolicy(this._options.policy);
        this._dlg = new DialogueInterface(null, {
            io: this,
            dispatcher: new SimpleCommandDispatcher(this),
            simulated: false,
            interactive: true,
            deterministic: true,
            flags: this._flags,
            ...this._options,
            policy: this._policy
        });
        this._agentGenerator = new InferenceTimeSentenceGenerator({ ...this._options, flags: this._flags, policy: this._policy });
        this._nlu = new CommandParser({
            ...this._options,
            generator: this._agentGenerator,
            policy: this._policy
        });

        let startMode = PolicyStartMode.NORMAL;
        if (initialState !== undefined) {
            if (initialState === 'null') {
                this._dlg.state = null;
            } else {
                const parsed = await ThingTalkUtils.parse(initialState, {
                    schemaRetriever: this._schemas,
                    thingpediaClient: this._thingpedia,
                    locale: this._options.locale,
                    timezone: this._options.timezone,
                });
                assert(parsed instanceof Ast.DialogueState);
                this._dlg.state = parsed;
            }
            startMode = PolicyStartMode.RESUME;
        } else if (!showWelcome) {
            startMode = PolicyStartMode.NO_WELCOME;
        }
        // TODO handle user first time

        const promise = this._waitReply();
        this._runPolicy(startMode);

        const reply = await promise;
        if (reply.messages.length === 0)
            return null;
        return reply;
    }

    private _waitReply() {
        assert(this._continuePromise === null);
        this._continuePromise = new Promise<ReplyResult>((resolve, reject) => {
            this._continueResolve = resolve;
        });
        return this._continuePromise;
    }

    private async _runPolicy(startMode : PolicyStartMode) {
        this._policyRunning ++;
        try {
            try {
                await this._policy.policy(this._dlg, startMode);
            } catch(e) {
                if (!(e instanceof TerminatedDialogueError) && !(e instanceof UnexpectedCommandError))
                    throw e;
            }
            // dialogue terminated, send the final message
            await this._dlg.flush();
            if (this._nextReply)
                this._nextReply.end = true;
            await this._sendReply(null, false);
        } finally {
            this._policyRunning --;
        }
    }

    getState() : string {
        return this._dlg.state ? this._dlg.state.prettyprint() : 'null';
    }

    reset() : void {
        // if we're already running a policy, cancel it with a terminated dialogue error
        // (which will bubble up)
        // note that policyRunning is a number not a boolean because we're concurrently
        // starting the new policy function, which will change policyRunning
        if (this._policyRunning > 0)
            this._commandQueue.cancelWait(new TerminatedDialogueError());
        this._dlg.state = null;
        this._runPolicy(PolicyStartMode.NO_WELCOME);
    }

    analyzeCommand(command : UserInput) {
        return this._nlu.parse(this._dlg.state, command, {
            raw: this._raw,
            expecting: this._expecting,
            choices: this._choices,
        });
    }

    getReply(analyzed : ThingTalkCommandAnalysisType) : Promise<ReplyResult> {
        const promise = this._waitReply();

        switch (analyzed.type) {
        case CommandAnalysisType.NONCONFIDENT_IN_DOMAIN_FOLLOWUP:
        case CommandAnalysisType.NONCONFIDENT_IN_DOMAIN_COMMAND: {
            // TODO move this to the state machine, not here

            /*
            const confirmation = await this._describeProgram(analyzed.parsed!);
            assert(confirmation, `Failed to compute a description of the current command`);
            const yesNo = await this._loop.ask(ValueCategory.YesNo, this._("Did you mean ${command}?"), { command: confirmation });
            assert(yesNo instanceof Ast.BooleanValue);
            if (!yesNo.value) {
                return {
                    messages: [this._("Sorry I couldn't help on that. Would you like to try again?")],
                    context: this._dialogueState ? this._dialogueState.prettyprint() : 'null',
                    agent_target: '$dialogue @org.thingpedia.dialogue.transaction.sys_clarify;',
                    expecting: this._loop.expecting,
                };
            }
            */

            // fallthrough to the confident case
        }

        case CommandAnalysisType.CONFIDENT_IN_DOMAIN_FOLLOWUP:
        case CommandAnalysisType.CONFIDENT_IN_DOMAIN_COMMAND:
        default: {
            const cmd = new Command(analyzed.utterance, this._dlg.state, analyzed.parsed as Ast.DialogueState);
            this._commandQueue.push(cmd);
        }
        }

        return promise;
    }

    /**
     * Flush out the reply to the user.
     *
     * @param expectingType what type to expect from the user after this reply
     */
    private async _sendReply(expectingType : Type|null, raw : boolean) {
        const before : ReplacedAgentMessage[] = [];
        const messages : ReplacedAgentMessage[] = [];
        let agent_target : string, end : boolean;

        if (this._nextReply) {
            agent_target = this._nextReply.meaning.prettyprint();
            messages.push(...this._nextReply.messages);

            for (const result of this._dlg.lastResult) {
                for (const [outputType, outputValue] of result.rawResults.slice(0, this._nextReply.numResults)) {
                    const formatted = await this._cardFormatter.formatForType(outputType, outputValue);
                    for (const msg of formatted) {
                        if (msg.type === 'sound' && (msg as any).before)
                            before.push(msg);
                        else
                            messages.push(msg);
                    }
                }
            }
            end = this._nextReply.end;
        } else {
            if (this._debug >= LogLevel.INFO)
                console.log(`Agent did not produce a reply in-between calls to get()`);
            agent_target = '';
            end = false;
        }

        let expecting : ValueCategory|null;
        if (expectingType === null) {
            expecting = null;
        } else if (expectingType instanceof Type.Enum) {
            for (const entry of expectingType.entries!) {
                const button = new Button({
                    type: 'button',
                    title: clean(entry),
                    json: JSON.stringify({ code: ['$answer', '(', 'enum', entry, ')', ';'], entities: {} })
                });
                messages.push(button);
            }
            expecting = ValueCategory.Generic;
        } else {
            expecting = ValueCategory.fromType(expectingType);
        }
        if (expecting === ValueCategory.RawString && !raw)
            expecting = ValueCategory.Generic;

        assert(this._continuePromise !== null);
        this._continueResolve!({
            messages : before.concat(messages),
            expecting,
            context: this._dlg.state ? this._dlg.state.prettyprint() : '',
            agent_target,
            end
        });
        this._continuePromise = null;
    }

    async get(expectingType : Type|null, raw = false) : Promise<Command> {
        if (this._continuePromise !== null)
            await this._sendReply(expectingType, raw);

        return this._commandQueue.pop();
    }

    private _expandTemplate(reply : Template<any[], AgentReplyRecord|void>, contextPhrases : ContextPhrase[]) {
        this._agentGenerator.reset();
        const [tmpl, placeholders, semantics] = reply;
        addTemplate(this._agentGenerator, [], tmpl, placeholders, semantics);

        return this._agentGenerator.generateOne(contextPhrases, '$dynamic');
    }

    private _getMainAgentContextPhrase() : ContextPhrase {
        return {
            symbol: this._agentGenerator.contextTable.ctx_dynamic_any,
            utterance: ReplacedResult.EMPTY,
            value: this._dlg.state,
            context: this,
            key: {}
        };
    }
    private *_getContextPhrases() : IterableIterator<ContextPhrase> {
        const phrases = this._policy.getContextPhrasesForState(this._dlg.state, this._agentGenerator.tpLoader,
            this._agentGenerator.contextTable);
        if (phrases !== null) {
            yield this._getMainAgentContextPhrase();

            for (const phrase of phrases) {
                // override the context because we need the context in _generateAgent
                phrase.context = this;
                yield phrase;
            }
        }
    }

    private _useNeuralNLG() : boolean {
        // TODO wire this up in some form
        //return this._prefs.get('experimental-use-neural-nlg') as boolean;
        return false;
    }

    async emit(replies : AgentReply) : Promise<boolean> {
        this.icon = this._dlg.state ? getProgramIcon(this._dlg.state) : null;

        await this._agentGenerator.initialize(this._dlg.state);
        const contextPhrases = Array.from(this._getContextPhrases());

        const utterances : ReplacedResult[] = [];
        const messages : ReplacedAgentMessage[] = [];
        let meaning : AgentReplyRecord|undefined = undefined;

        messageloop: for (const reply of replies) {
            if (reply.type === 'text') {
                const derivation = this._expandTemplate([reply.text, reply.args, reply.meaning], contextPhrases);
                if (!derivation)
                    continue;
                if (derivation.value !== undefined)
                    meaning = derivation.value;
                if (messages.length > 0) {
                    let utterance = derivation.sentence.chooseBest();
                    utterance = utterance.replace(/ +/g, ' ');
                    utterance = this._langPack.postprocessSynthetic(utterance, null, this._dlg.rng, 'agent');
                    utterance = this._langPack.postprocessNLG(utterance, this._agentGenerator.entities, this._executor);
                    messages.push({
                        type: 'text',
                        text: utterance
                    });
                } else {
                    utterances.push(derivation.sentence);
                }
            } else {
                const msg : any = { type: reply.type };
                for (const key in reply) {
                    if (key === 'type' || key === 'args')
                        continue;
                    if (key === 'title' || key === 'alt' || key === 'displayTitle' || key === 'displayText') {
                        const derivation = this._expandTemplate([(reply as any)[key], reply.args, () => undefined], contextPhrases);
                        if (!derivation)
                            continue messageloop;

                        let utterance = derivation.sentence.chooseBest();
                        utterance = utterance.replace(/ +/g, ' ');
                        utterance = this._langPack.postprocessSynthetic(utterance, null, this._dlg.rng, 'agent');
                        utterance = this._langPack.postprocessNLG(utterance, this._agentGenerator.entities, this._executor);
                        msg[key] = utterance;
                    } else {
                        msg[key] = (reply as any)[key];
                    }
                }
                messages.push(msg);
            }
        }
        if (!meaning || utterances.length === 0)
            return false;
        this._dlg.state = ThingTalkUtils.computeNewState(this._dlg.state, meaning.meaning, 'agent').optimize();

        let utterance = new ReplacedConcatenation(utterances, {}, {}).chooseBest();
        if (this._useNeuralNLG()) {
            const prepared = ThingTalkUtils.prepareContextForPrediction(this._dlg.state, 'agent');
            const [contextCode, contextEntities] = ThingTalkUtils.serializeNormalized(prepared);

            const [targetAct,] = ThingTalkUtils.serializeNormalized(meaning.meaning, contextEntities);
            const result = await this._nlg.generateUtterance(contextCode, contextEntities, targetAct);
            utterance = result[0].answer;
        }

        utterance = this._langPack.postprocessNLG(utterance, this._agentGenerator.entities, this._executor);
        messages.unshift({
            type: 'text',
            text: utterance
        });

        this._nextReply = {
            messages,
            ...meaning,
            end: false
        };
        return true;
    }

    prepareContextForPrediction() {
        return this._nlu.prepareContextForPrediction(this._dlg.state);
    }

    async showNotification(program : Ast.Program,
                           name : string,
                           outputType : string,
                           outputValue : Record<string, unknown>) : Promise<ReplyResult> {
        assert(program.statements.length === 1);
        const stmt = program.statements[0];
        assert(stmt instanceof Ast.ExpressionStatement);
        assert(stmt.expression.schema);

        /*
        const mappedResult = await this._agent.executor.mapResult(stmt.expression.schema, outputValue);
        this._dialogueState = await this._policy.getNotificationState(app.name, app.program, mappedResult);
        return this._doAgentReply([[outputType, outputValue]]);
        */
        throw new Error('not implemented');
    }

    async showAsyncError(program : Ast.Program,
                         name : string,
                         error : Error) : Promise<ReplyResult> {
        //console.log('Error from ' + app.uniqueId, error);

        /*
        const mappedError = await this._agent.executor.mapError(error);
        this._dialogueState = await this._policy.getAsyncErrorState(app.name, app.program, mappedError);
        return this._doAgentReply([]);
        */
        throw new Error('not implemented');
    }
}
