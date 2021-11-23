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
import { ReplacedResult } from '../utils/template-string';
import { clean } from '../utils/misc-utils';
import { getProgramIcon } from '../utils/icons';

import {
    AgentExtensionMessage,
    AgentReply,
    AgentReplyRecord,
    ContextPhrase,
    SemanticAction,
    Template,
    TemplatePlaceholderMap
} from '../sentence-generator/types';
import { LogLevel } from '../sentence-generator/runtime';

import ValueCategory from '../dialogue-runtime/value-category';
import { UserInput, } from '../dialogue-runtime/user-input';
import CardFormatter from '../dialogue-runtime/card-output/card-formatter';
import {
    CommandAnalysisType,
    DialogueHandler,
    ReplyResult,
} from '../dialogue-runtime/dialogue-loop';
import { Button } from '../dialogue-runtime/card-output/format_objects';

import { DialogueInterface, } from './interface';
import {
    PolicyModule, PolicyStartMode
} from './policy';
import { Command, Confidence } from './command';
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
import { addConcatenationTemplate, addTemplate, splitAgentReply } from './template-utils';

type ReplacedAgentMessage = Tp.FormatObjects.FormattedObject | {
    type : 'link';
    title : string;
    url : string;
};

interface EmptyAgentReplyRecord {
    meaning : undefined;
    numResults : 0;
}

interface ExtendedAgentReplyRecord extends AgentReplyRecord {
    messages : ReplacedAgentMessage[];
    context : string;
    finished : boolean;
}

interface InferenceTimeDialogueOptions {
    conversationId : string;
    nlu ?: ParserClient.ParserClient,
    nlg ?: ParserClient.ParserClient,
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

function emptyMeaning() : EmptyAgentReplyRecord {
    return { meaning: undefined, numResults: 0 };
}

function mapConfidence(analyzed : ThingTalkCommandAnalysisType) : Confidence {
    switch (analyzed.type) {
    case CommandAnalysisType.EXACT_IN_DOMAIN_COMMAND:
    case CommandAnalysisType.EXACT_IN_DOMAIN_FOLLOWUP:
    case CommandAnalysisType.STOP:
    case CommandAnalysisType.DEBUG:
        return Confidence.ABSOLUTE;

    case CommandAnalysisType.CONFIDENT_IN_DOMAIN_COMMAND:
    case CommandAnalysisType.CONFIDENT_IN_DOMAIN_FOLLOWUP:
        return Confidence.HIGH;

    case CommandAnalysisType.NONCONFIDENT_IN_DOMAIN_COMMAND:
    case CommandAnalysisType.NONCONFIDENT_IN_DOMAIN_FOLLOWUP:
        return Confidence.LOW;

    default:
        return Confidence.NO;
    }
}


let _cnt = 0;

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
    private readonly _nlg ?: ParserClient.ParserClient|undefined;
    private _nlu : CommandParser|undefined;
    private _dlg ! : DialogueInterface;
    private _policy ! : PolicyModule;
    private _agentGenerator ! : InferenceTimeSentenceGenerator;
    private readonly _cardFormatter : CardFormatter;
    private readonly _debug : number;
    private readonly _flags : Record<string, boolean>;

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
    private _policyRunning : boolean;
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

        this._expecting = null;
        this._choices = [];

        this._policyRunning = false;
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
     * Low-level access to the thingpedia loader.
     *
     * This is used by certain code paths to handle raw commands.
     */
    get agentTpLoader() {
        return this._agentGenerator.tpLoader;
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
        if (this._options.nlu) {
            this._nlu = new CommandParser({
                ...this._options,
                nlu: this._options.nlu,
                generator: this._agentGenerator,
                policy: this._policy
            });
        }

        let startMode = PolicyStartMode.NORMAL;
        if (initialState !== undefined) {
            if (initialState === 'null') {
                this._dlg.state = null;
            } else {
                try {
                    const parsed = await ThingTalkUtils.parse(initialState, {
                        schemaRetriever: this._schemas,
                        thingpediaClient: this._thingpedia,
                        locale: this._options.locale,
                        timezone: this._options.timezone,
                    });
                    assert(parsed instanceof Ast.DialogueState);
                    this._dlg.state = parsed;
                } catch(e) {
                    if (e.code === 'ECANCELLED')
                        return null;
                    console.error(`Failed to restore conversation state: ${e.message}`);
                    this._dlg.state = null;
                    return null;
                }
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
        this._setExpecting(reply);

        return reply;
    }

    private _setExpecting(reply : ReplyResult) {
        this._expecting = reply.expecting;
        this._choices = reply.messages.flatMap((msg) => {
            if (typeof msg === 'object' && msg.type === 'choice')
                return msg.title;
            return [];
        });
    }

    private _waitReply() {
        assert(this._continuePromise === null);
        this._continuePromise = new Promise<ReplyResult>((resolve, reject) => {
            this._continueResolve = resolve;
        });
        return this._continuePromise;
    }

    private async _runPolicy(startMode : PolicyStartMode) {
        const cnt = _cnt++;
        this._policyRunning = true;
        if (this._debug >= LogLevel.INFO)
            console.log(`Starting policy (conversation ${this._options.conversationId}, iteration ${cnt}, startMode: ${PolicyStartMode[startMode]})`);
        try {
            await this._policy.policy(this._dlg, startMode);
        } catch(e) {
            if (!(e instanceof TerminatedDialogueError) && !(e instanceof UnexpectedCommandError))
                throw e;
        }

        // dialogue terminated, send the final message
        await this._dlg.flush();
        if (this._nextReply)
            this._nextReply.finished = true;
        if (this._debug >= LogLevel.INFO)
            console.log(`Policy finished (conversation ${this._options.conversationId}, iteration ${cnt})`);
        this._policyRunning = false;
        await this._sendReply(null, false);
    }

    getState() : string {
        if (!this._dlg)
            throw new Error(`Not initialized`);
        return this._dlg.state ? this._dlg.state.prettyprint() : 'null';
    }

    async reset() : Promise<void> {
        await this.terminate();

        this._dlg.state = null;
        this._runPolicy(PolicyStartMode.NO_WELCOME);
    }

    async terminate() : Promise<void> {
        if (!this._policyRunning)
            return;

        // if we're running a policy, cancel it with a terminated dialogue error
        // (which will bubble up) and wait until the continue promise is reset to null
        const promise = this._waitReply();
        this._commandQueue.cancelWait(new TerminatedDialogueError());
        await promise;
        assert(this._continuePromise === null);
        assert(!this._policyRunning);
    }

    analyzeCommand(command : UserInput) {
        if (!this._nlu)
            throw new Error(`Dialogue instantiated without NLU, cannot analyze`);
        return this._nlu.parse(this._dlg.state, command, {
            expecting: this._expecting,
            choices: this._choices,
        });
    }

    async getReply(analyzed : ThingTalkCommandAnalysisType) : Promise<ReplyResult> {
        const promise = this._waitReply();

        const cmd = new Command(analyzed.utterance, this._dlg.state, analyzed.parsed as Ast.DialogueState, mapConfidence(analyzed), analyzed.platformData);
        this._commandQueue.push(cmd);

        const reply = await promise;
        this._setExpecting(reply);

        return reply;
    }

    /**
     * Flush out the reply to the user.
     *
     * @param expectingType what type to expect from the user after this reply
     */
    private async _sendReply(expectingType : Type|null, raw : boolean) {
        const before : ReplacedAgentMessage[] = [];
        const messages : ReplacedAgentMessage[] = [];
        let context : string, agent_target : string, finished : boolean;

        if (this._nextReply) {
            context = this._nextReply.context;
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
            finished = this._nextReply.finished;
        } else {
            if (this._debug >= LogLevel.INFO)
                console.log(`Agent did not produce a reply at this turn (conversation ${this._options.conversationId})`);
            context = '';
            agent_target = '';
            finished = false;
        }
        this._nextReply = null;

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
            context,
            agent_target,
            finished
        });
        this._continuePromise = null;
    }

    async get(expectingType : Type|null, raw : boolean) : Promise<Command> {
        if (this._continuePromise !== null)
            await this._sendReply(expectingType, raw);

        return this._commandQueue.pop();
    }

    private _expandTemplate(tmpl : string,
                            placeholders : TemplatePlaceholderMap,
                            semantics : SemanticAction<any[], any>,
                            contextPhrases : ContextPhrase[]) {
        this._agentGenerator.reset();
        addTemplate(this._agentGenerator, [], tmpl, placeholders, semantics);
        return this._agentGenerator.generateOne<unknown>(contextPhrases, '$dynamic');
    }

    private _expandConcatenationTemplate(replies : Array<Template<any[], AgentReplyRecord|EmptyAgentReplyRecord>>, contextPhrases : ContextPhrase[]) {
        this._agentGenerator.reset();
        addConcatenationTemplate(this._agentGenerator, [], replies, (current, next) => {
            if (current === undefined)
                return next;
            if (next.meaning !== undefined)
                return next;
            else
                return current;
        });

        return this._agentGenerator.generateOne<AgentReplyRecord|EmptyAgentReplyRecord>(contextPhrases, '$dynamic');
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

    private _replaceExtensionMessage(reply : AgentExtensionMessage, contextPhrases : ContextPhrase[]) {
        const msg : any = { type: reply.type };
        for (const key in reply) {
            if (key === 'type' || key === 'args')
                continue;
            if (key === 'title' || key === 'alt' || key === 'displayTitle' || key === 'displayText') {
                const derivation = this._expandTemplate((reply as any)[key], reply.args, emptyMeaning, contextPhrases);
                if (!derivation)
                    return null;

                let utterance = derivation.sentence.chooseBest();
                utterance = utterance.replace(/ +/g, ' ');
                // note: we don't call postprocessSynthetic for secondary messages here
                utterance = this._langPack.postprocessNLG(utterance, this._agentGenerator.entities, this._executor);
                msg[key] = utterance;
            } else {
                msg[key] = (reply as any)[key];
            }
        }

        return msg as ReplacedAgentMessage;
    }

    async emit(replies : AgentReply) : Promise<AgentReplyRecord|null> {
        this.icon = this._dlg.state ? getProgramIcon(this._dlg.state) : null;

        await this._agentGenerator.initialize(this._dlg.state);
        const contextPhrases = Array.from(this._getContextPhrases());

        const messages : ReplacedAgentMessage[] = [];

        const [before, main, after] = splitAgentReply(replies);

        for (const reply of before) {
            const msg = this._replaceExtensionMessage(reply, contextPhrases);
            if (msg !== null)
                messages.push(msg);
        }

        const mainDerivation = this._expandConcatenationTemplate(main.map((reply) => [reply.text, reply.args, reply.meaning ?? emptyMeaning]), contextPhrases);
        if (!mainDerivation || !mainDerivation.value.meaning)
            return null;
        const meaning : AgentReplyRecord = mainDerivation.value;
        const context = this._dlg.state ? this._dlg.state.prettyprint() : '';
        this._dlg.state = ThingTalkUtils.computeNewState(this._dlg.state, meaning.meaning, 'agent').optimize();

        let utterance = mainDerivation.sentence.chooseBest();
        utterance = this._langPack.postprocessSynthetic(utterance, meaning.meaning, this._dlg.rng, 'agent');

        if (this._nlg && this._useNeuralNLG()) {
            const prepared = ThingTalkUtils.prepareContextForPrediction(this._dlg.state, 'agent');
            const [contextCode, contextEntities] = ThingTalkUtils.serializeNormalized(prepared);

            const [targetAct,] = ThingTalkUtils.serializeNormalized(meaning.meaning, contextEntities);
            const result = await this._nlg.generateUtterance(contextCode, contextEntities, targetAct);
            utterance = result[0].answer;
        }
        utterance = this._langPack.postprocessNLG(utterance, this._agentGenerator.entities, this._executor);
        messages.push({
            type: 'text',
            text: utterance
        });

        for (const reply of after) {
            if (reply.type === 'text') {
                const derivation = this._expandTemplate(reply.text, reply.args, reply.meaning ?? emptyMeaning, contextPhrases);
                if (!derivation)
                    continue;
                let utterance = derivation.sentence.chooseBest();
                utterance = utterance.replace(/ +/g, ' ');
                // note: we don't call postprocessSynthetic or the neural NLG for secondary messages here
                utterance = this._langPack.postprocessNLG(utterance, this._agentGenerator.entities, this._executor);
                if (utterance) {
                    messages.push({
                        type: 'text',
                        text: utterance
                    });
                }
            } else {
                const msg = this._replaceExtensionMessage(reply, contextPhrases);
                if (msg !== null)
                    messages.push(msg);
            }
        }

        this._nextReply = {
            messages,
            ...meaning,
            context,
            finished: false
        };
        return meaning;
    }

    prepareContextForPrediction() {
        return CommandParser.prepareContextForPrediction(this._dlg.state);
    }

    async showNotification(program : Ast.Program,
                           name : string|null,
                           outputValue : Record<string, unknown>) : Promise<ReplyResult> {
        assert(program.statements.length === 1);
        const stmt = program.statements[0];
        assert(stmt instanceof Ast.ExpressionStatement);
        assert(stmt.expression.schema);

        const promise = this._waitReply();
        const mappedResult = await ThingTalkUtils.mapResult(stmt.expression.schema, outputValue);
        const semantics = await this._policy.notification?.(name, program, mappedResult);
        if (!semantics)
            throw new Error(`Unsupported notification from ${name}`);

        const cmd = new Command('notification', this._dlg.state, semantics, Confidence.ABSOLUTE, {});
        this._commandQueue.push(cmd);

        const reply = await promise;
        this._setExpecting(reply);

        return reply;
    }

    async showAsyncError(program : Ast.Program,
                         name : string|null,
                         error : Error) : Promise<ReplyResult> {
        const promise = this._waitReply();
        const mappedError = await ThingTalkUtils.mapError(error);
        const semantics = await this._policy.notifyError?.(name, program, mappedError);
        if (!semantics)
            throw new Error(`Unsupported notification from ${name}`);

        const cmd = new Command('error', this._dlg.state, semantics, Confidence.ABSOLUTE, {});
        this._commandQueue.push(cmd);

        const reply = await promise;
        this._setExpecting(reply);

        return reply;
    }
}
