// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
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
import AsyncQueue from 'consumer-queue';

import { Replaceable, ReplacedConcatenation, ReplacedResult } from '../utils/template-string';
import type Engine from '../engine';
import * as ParserClient from '../prediction/parserclient';
import * as I18n from '../i18n';

import ValueCategory from './value-category';
import QueueItem from './dialogue_queue';
import { UserInput, } from './user-input';
import { AgentInput } from './agent-input';
import { PlatformData } from './protocol';
import { CancellationError } from './errors';

import type Conversation from './conversation';
import { ConversationState } from './conversation';
import AppExecutor from '../engine/apps/app_executor';
import DeviceInterfaceMapper from '../engine/devices/device_interface_mapper';

import ExecutionDialogueAgent from './execution_dialogue_agent';
import ThingTalkDialogueHandler from './handlers/thingtalk';
import FAQDialogueHandler from './handlers/faq';
import ThingpediaDialogueHandler from './handlers/3rdparty';
import DeviceView from '../engine/devices/device_view';

export enum CommandAnalysisType {
    // special commands - these are generated by the exact matcher, or
    // by UI buttons like the "X" button
    STOP,
    NEVERMIND,
    WAKEUP,
    DEBUG,

    // some sort of command
    EXACT_IN_DOMAIN_COMMAND,
    STRONGLY_CONFIDENT_IN_DOMAIN_COMMAND,
    CONFIDENT_IN_DOMAIN_COMMAND,
    NONCONFIDENT_IN_DOMAIN_COMMAND,
    EXACT_IN_DOMAIN_FOLLOWUP,
    STRONGLY_CONFIDENT_IN_DOMAIN_FOLLOWUP,
    CONFIDENT_IN_DOMAIN_FOLLOWUP,
    NONCONFIDENT_IN_DOMAIN_FOLLOWUP,
    OUT_OF_DOMAIN_COMMAND,
}

export const enum Confidence {
    NO,
    LOW,
    NORMAL,
    HIGH,
    ABSOLUTE
}

export interface CommandAnalysisResult {
    type : CommandAnalysisType;
    // used in the conversation logs
    utterance : string;
    user_target : string;
}

export interface ReplyResult {
    messages : Array<string|Tp.FormatObjects.FormattedObject>;
    expecting : ValueCategory|null;

    // used in the conversation logs
    context : string;
    agent_target : string;
}

export interface DialogueHandler<AnalysisType extends CommandAnalysisResult, StateType> {
    priority : Tp.DialogueHandler.Priority;
    uniqueId : string;
    icon : string|null;

    initialize(initialState : StateType|undefined, showWelcome : boolean) : Promise<ReplyResult|null>;
    getState() : StateType;
    reset() : void;

    analyzeCommand(command : UserInput) : Promise<AnalysisType>;
    getReply(command : AnalysisType) : Promise<ReplyResult>;
    getFollowUp() : Promise<ReplyResult|null>;
}

export class DialogueLoop {
    conversation : Conversation;
    engine : Engine;

    private _langPack : I18n.LanguagePack;
    private _userInputQueue : AsyncQueue<UserInput>;
    private _notifyQueue : AsyncQueue<QueueItem>;
    private _debug : boolean;
    private _agent : ExecutionDialogueAgent;
    private _nlu : ParserClient.ParserClient;
    private _nlg : ParserClient.ParserClient;
    private _thingtalkHandler : ThingTalkDialogueHandler;
    private _faqHandlers : Record<string, FAQDialogueHandler>;
    private _dynamicHandlers : DeviceInterfaceMapper<DialogueHandler<CommandAnalysisResult, any>>;
    private _currentHandler : DialogueHandler<CommandAnalysisResult, any>|null;

    private icon : string|null;
    expecting : ValueCategory|null;
    platformData : PlatformData;
    choices : string[];
    raw = false;

    private _stopped = false;
    private _mgrResolve : (() => void)|null;
    private _mgrPromise : Promise<void>|null;

    constructor(conversation : Conversation,
                engine : Engine,
                options : {
                    nluServerUrl : string|undefined;
                    nlgServerUrl : string|undefined;
                    useConfidence : boolean;
                    debug : boolean;
                    rng : () => number;
                    faqModels : Record<string, {
                        url : string;
                        highConfidence ?: number;
                        lowConfidence ?: number;
                    }>
                }) {
        this._userInputQueue = new AsyncQueue();
        this._notifyQueue = new AsyncQueue();

        this._debug = options.debug;
        this.conversation = conversation;
        this.engine = engine;
        this._langPack = I18n.get(engine.platform.locale);
        this._agent = new ExecutionDialogueAgent(engine, this, options.debug);
        this._nlu = ParserClient.get(options.nluServerUrl || undefined, engine.platform.locale, engine.platform,
            undefined, engine.thingpedia);
        this._nlg = ParserClient.get(options.nlgServerUrl || undefined, engine.platform.locale, engine.platform);
        this._thingtalkHandler = new ThingTalkDialogueHandler(engine, this, this._agent, this._nlu, this._nlg, options);
        this._faqHandlers = {};
        for (const faq in options.faqModels)
            this._faqHandlers[faq] = new FAQDialogueHandler(this, faq, options.faqModels[faq], { locale: engine.platform.locale });
        this._dynamicHandlers = new DeviceInterfaceMapper(new DeviceView(engine.devices, 'org.thingpedia.dialogue-handler', {}),
            (device) => new ThingpediaDialogueHandler(device));
        this._currentHandler = null;

        this.icon = null;
        this.expecting = null;
        this.choices = [];
        this.platformData = {};

        this._mgrResolve = null;
        this._mgrPromise = null;
    }

    get _() : (x : string) => string {
        return this.conversation._;
    }
    get isAnonymous() : boolean {
        return this.conversation.isAnonymous;
    }
    get hasDebug() : boolean {
        return this._debug;
    }

    getState() : Record<string, unknown> {
        const state : Record<string, unknown> = {};
        for (const handler of this._iterateDialogueHandlers())
            state[handler.uniqueId] = handler.getState();
        return state;
    }

    debug(...args : unknown[]) {
        if (!this._debug)
            return;
        console.log(...args);
    }

    interpolate(msg : string, args : Record<string, unknown>) : string {
        const replacements = [];
        const names = [];
        for (const key in args) {
            names.push(key);
            const value = args[key];
            if (value !== null && value !== undefined) {
                replacements.push({
                    text: value instanceof ReplacedResult ? value : new ReplacedConcatenation([String(value)], {}, {}),
                    value,
                });
            } else {
                replacements.push(undefined);
            }
        }

        const tmpl = Replaceable.get(msg, this._langPack, names);
        return this._langPack.postprocessNLG(tmpl.replace({ replacements, constraints: {} })!.chooseBest(), {}, this._agent);
    }

    private _formatError(error : Error|string) {
        if (typeof error === 'string')
            return error;
        else if (error.name === 'SyntaxError')
            return this.interpolate(this._("Syntax error {at ${error.fileName}|} {line ${error.lineNumber}|}: ${error.message}"), { error });
        else if (error.message)
            return error.message;
        else
            return String(error);
    }

    async nextCommand() : Promise<UserInput> {
        await this.conversation.sendAskSpecial();
        this._mgrPromise = null;
        this._mgrResolve!();
        const intent = await this._userInputQueue.pop();
        this.platformData = intent.platformData;
        return intent;
    }

    private *_iterateDialogueHandlers() {
        yield this._thingtalkHandler;

        for (const key in this._faqHandlers)
            yield this._faqHandlers[key];

        yield* this._dynamicHandlers.values();
    }

    private async _analyzeCommand(command : UserInput) : Promise<[DialogueHandler<any, any>|undefined, CommandAnalysisResult]> {
        try {
            const handlers = [...this._iterateDialogueHandlers()];
            const handlerCandidates = await Promise.all(handlers.map(async (handler) => {
                const analysis = await handler.analyzeCommand(command);
                return { handler: handler, analysis: analysis };
            }));

            return pickHandler(this._currentHandler, this.expecting, handlerCandidates, command, this._debug);
        } catch(e : any) {
            if (e.code === 'EHOSTUNREACH' || e.code === 'ETIMEDOUT') {
                await this.reply(this._("Sorry, I cannot contact the Genie service. Please check your Internet connection and try again later."), null);
                throw new CancellationError();
            } else if (typeof e.code === 'number' && (e.code === 404 || e.code >= 500)) {
                await this.reply(this._("Sorry, there seems to be a problem with the Genie service at the moment. Please try again later."), null);
                throw new CancellationError();
            } else {
                throw e;
            }
        }
    }

    private async _handleUICommand(type : CommandAnalysisType) {
        switch (type) {
        case CommandAnalysisType.STOP:
            // stop means cancel, but without a failure message + stopping audio
            if (this.engine.audio)
                await this.engine.audio.stopAudio(this.conversation.id);
            throw new CancellationError();

        case CommandAnalysisType.NEVERMIND:
            await this.reply(this._("Sorry I couldn't help on that."));
            throw new CancellationError();

        case CommandAnalysisType.DEBUG:
            await this.reply("Current State:\n");
            for (const handler of this._iterateDialogueHandlers())
                await this.reply(handler.uniqueId + ': ' + handler.getState());
            break;
        }
    }

    private async _handleAPICall(call : QueueItem) {
        if (call instanceof QueueItem.Notification)
            await this._sendAgentReply(await this._thingtalkHandler.showNotification(call.app, call.outputType, call.outputValue));
        else if (call instanceof QueueItem.Error)
            await this._sendAgentReply(await this._thingtalkHandler.showAsyncError(call.app, call.error));
    }

    private async _sendAgentReply(reply : ReplyResult) {
        this.conversation.updateLog('context', reply.context);
        this.conversation.updateLog('agent_target', reply.agent_target);

        for (const msg of reply.messages)
            await this.replyGeneric(msg);

        await this.setExpected(reply.expecting);
    }

    // FIXME: do Jackie's stuff
    private async _mockGetFollowUp(reply : ReplyResult) {
        console.log(reply.messages);
        return null;
    }

    //FIXME: handle AgentInput
    private async _handleAgentInput(ttCommand : AgentInput) {
        // pick agent input designated handler
        const handlers = [...this._iterateDialogueHandlers()];
        const handler = handlers.filter((handler) => handler.uniqueId.toLowerCase() === 'thingtalk')[0];
        console.log(handler)
        if (!handler) {
            await this.fail();
            return;
        }

        // reset the state of the handler when we switch to a different one
        if (this._currentHandler && handler !== this._currentHandler)
            this._currentHandler.reset();
        this._currentHandler = handler;

        // parse thingtalk invocation
        const analysis = await handler.analyzeCommand(ttCommand);
        // execute thingtalk invocation and get results
        const reply = await handler.getReply(analysis);
        this.icon = handler.icon;

        const followUp : ReplyResult|null = await this._mockGetFollowUp(reply);
        // const followUp : ReplyResult|null = await handler.getFollowUp();
        if (followUp === null)
            return;
        this.icon = handler.icon;
        await this._sendAgentReply(followUp);   
    }

    private _putAgentInputToQueue(analysis : any) {
        if (analysis.inner && ('device' in analysis.inner) && ('agent_init' in analysis.inner)) {
            const ttc : AgentInput = {
                type : 'thingtalk',
                device : analysis.inner.device,
                parsed : analysis.inner.agent_init,
                platformData : {}
            };
            this._pushQueueItem(new QueueItem.AgentInput(ttc));
            console.log('Put AgentInput to QueueItem');
        }
    }

    private async _handleUserInput(command : UserInput) {
        for (;;) {
            const [handler, analysis] = await this._analyzeCommand(command);
            // save the utterance and complete the turn
            // skip the log if the command was ignored
            this.conversation.updateLog('user', analysis.utterance);
            this.conversation.updateLog('user_target', analysis.user_target);
            await this.conversation.turnFinished();

            if (!handler) {
                await this.fail();
                return;
            }

            if (analysis.type === CommandAnalysisType.STOP ||
                analysis.type === CommandAnalysisType.DEBUG) {
                await this._handleUICommand(analysis.type);
                command = await this.nextCommand();
                continue;
            }

            // reset the state of the handler when we switch to a different one
            if (this._currentHandler && handler !== this._currentHandler)
                await this._currentHandler.reset();
            this._currentHandler = handler;
            const reply = await handler.getReply(analysis);

            //FIXME: put AgentInput into QueueItem if there is any
            this._putAgentInputToQueue(analysis);

            this.icon = handler.icon;
            await this._sendAgentReply(reply);

            while (this.expecting === null) {
                const followUp : ReplyResult|null = await handler.getFollowUp();
                if (followUp === null)
                    break;

                this.icon = handler.icon;
                await this._sendAgentReply(followUp);
            }

            // if we're not expecting any more answer from the user,
            // exit this loop
            // note: this does not mean the dialogue is terminated!
            // state is preserved until we call reset() due to context reset
            // timeout, or some command causes a CancellationError
            // (typically, "never mind", or a "no" in sys_anything_else)
            //
            // exiting this loop means that we close the microphone
            // (requiring a wakeword again to continue) and start
            // processing notifications again

            if (this.expecting === null)
                return;
            command = await this.nextCommand();
        }
    }

    private async _initialize(showWelcome : boolean, initialState : Record<string, unknown>|null) {
        let bestreply : ReplyResult|undefined, bestpriority = -1;
        for (const handler of this._iterateDialogueHandlers()) {
            const reply = await handler.initialize(initialState ? initialState[handler.uniqueId] : undefined, showWelcome);
            if (reply !== null && handler.priority > bestpriority) {
                bestpriority = handler.priority;
                bestreply = reply;
            }
        }

        if (bestreply)
            await this._sendAgentReply(bestreply);
        else
            await this.setExpected(null);
    }

    private async _loop(showWelcome : boolean, initialState : Record<string, unknown>|null) {
        await this._initialize(showWelcome, initialState);

        while (!this._stopped) {
            let item;
            try {
                item = await this.nextQueueItem();
                if (item instanceof QueueItem.UserInput)
                    await this._handleUserInput(item.command);
                else if (item instanceof QueueItem.AgentInput)
                    await this._handleAgentInput(item.ttCommand);
                else
                    await this._handleAPICall(item);
            } catch(e : any) {
                if (e.code === 'ECANCELLED') {
                    for (const handler of this._iterateDialogueHandlers())
                        handler.reset();
                    this._currentHandler = null;
                    this.icon = null;
                    await this.setExpected(null);
                    // if the dialogue terminated, save the last utterance from the agent
                    // in a new turn with an empty utterance from the user
                    await this.conversation.dialogueFinished();
                } else {
                    console.error(`Error processing queue item`, item);
                    console.error(e);
                    if (item instanceof QueueItem.UserInput) {
                        await this.replyInterp(this._("Sorry, I had an error processing your command: ${error}."), { //"
                            error: this._formatError(e)
                        });
                    } else {
                        await this.replyInterp(this._("Sorry, that did not work: ${error}."), {
                            error: this._formatError(e)
                        });
                    }
                    for (const handler of this._iterateDialogueHandlers())
                        handler.reset();
                }
            }
        }
    }

    async nextQueueItem() : Promise<QueueItem> {
        await this.conversation.sendAskSpecial();
        this._mgrPromise = null;
        this._mgrResolve!();
        const queueItem = await this._notifyQueue.pop();
        if (queueItem instanceof QueueItem.UserInput)
            this.platformData = queueItem.command.platformData;
        else
            this.platformData = {};
        return queueItem;
    }

    async lookingFor() {
        if (this.expecting === ValueCategory.YesNo) {
            await this.reply(this._("Please answer yes or no."));
        } else if (this.expecting === ValueCategory.MultipleChoice) {
            await this.reply(this._("Could you choose one of the following?"));
            await this._resendChoices();
        } else if (this.expecting === ValueCategory.Measure) {
            await this.reply(this._("Could you give me a measurement?"));
        } else if (this.expecting === ValueCategory.Number) {
            await this.reply(this._("Could you give me a number?"));
        } else if (this.expecting === ValueCategory.Date) {
            await this.reply(this._("Could you give me a date?"));
        } else if (this.expecting === ValueCategory.Time) {
            await this.reply(this._("Could you give me a time of day?"));
        } else if (this.expecting === ValueCategory.Picture) {
            await this.reply(this._("Could you upload a picture?"));
        } else if (this.expecting === ValueCategory.Location) {
            await this.reply(this._("Could you give me a place?"));
        } else if (this.expecting === ValueCategory.PhoneNumber) {
            await this.reply(this._("Could you give me a phone number?"));
        } else if (this.expecting === ValueCategory.EmailAddress) {
            await this.reply(this._("Could you give me an email address?"));
        } else if (this.expecting === ValueCategory.RawString || this.expecting === ValueCategory.Password) {
            // ValueCategory.RawString puts us in raw mode,
            // so we accept almost everything
            // but this will happen if the user clicks a button
            // or upload a picture
            await this.reply(this._("Which is interesting, because I'll take anything at all. Just type your mind!"));
        }
    }

    async fail(msg ?: string) {
        if (this.expecting === null) {
            if (msg) {
                await this.replyInterp(this._("Sorry, I did not understand that: ${error}. Can you rephrase it?"), {
                    error: msg
                });
            } else {
                await this.reply(this._("Sorry, I did not understand that. Can you rephrase it?"));
            }
        } else {
            if (msg)
                await this.replyInterp(this._("Sorry, I did not understand that: ${error}."), { error: msg });
            else
                await this.reply(this._("Sorry, I did not understand that."));
        }
        throw new CancellationError();
    }

    setExpected(expected : ValueCategory|null, raw = (expected === ValueCategory.RawString || expected === ValueCategory.Password)) {
        if (expected === undefined)
            throw new TypeError();
        this.expecting = expected;
        this.raw = raw;
        const [contextCode, contextEntities] = this._thingtalkHandler.prepareContextForPrediction();
        this.conversation.setExpected(expected, { code: contextCode, entities: contextEntities });
    }

    /**
     * Ask a question to the user.
     *
     * This is a legacy method used for certain scripted interactions.
     */
    async ask(expected : ValueCategory.YesNo|ValueCategory.PhoneNumber|ValueCategory.EmailAddress|ValueCategory.Location|ValueCategory.Time,
              question : string,
              args ?: Record<string, unknown>) : Promise<ThingTalk.Ast.Value> {
        await this.replyInterp(question, args);
        // force the question to occur in raw mode for locations
        // because otherwise we send it to the parser and the parser will
        // likely misbehave as it's a state that we've never seen in training
        await this.setExpected(expected, expected === ValueCategory.Location);

        // ignore the OOD logic here because we're bypassing the state machine
        let analyzed = await this._thingtalkHandler.analyzeCommand(await this.nextCommand());
        while (analyzed.answer === null || typeof analyzed.answer === 'number' ||
               ValueCategory.fromType(analyzed.answer.getType()) !== expected) {
            switch (analyzed.type) {
            case CommandAnalysisType.STOP:
            case CommandAnalysisType.NEVERMIND:
            case CommandAnalysisType.DEBUG:
                await this._handleUICommand(analyzed.type);
                break;

            default:
                await this.fail();
                await this.lookingFor();
            }

            analyzed = await this._thingtalkHandler.analyzeCommand(await this.nextCommand());
        }
        return analyzed.answer;
    }

    async askChoices(question : string, choices : string[]) : Promise<number> {
        await this.reply(question);
        this.setExpected(ValueCategory.MultipleChoice);
        this.choices = choices;
        for (let i = 0; i < choices.length; i++)
            await this.conversation.sendChoice(i, choices[i]);

        // ignore the OOD logic here because we're bypassing the state machine
        let analyzed = await this._thingtalkHandler.analyzeCommand(await this.nextCommand());
        while (analyzed.answer === null || typeof analyzed.answer !== 'number'
               || analyzed.answer < 0 || analyzed.answer >= choices.length) {
            switch (analyzed.type) {
            case CommandAnalysisType.STOP:
            case CommandAnalysisType.NEVERMIND:
            case CommandAnalysisType.DEBUG:
                await this._handleUICommand(analyzed.type);
                break;

            default:
                await this.fail();
                await this.lookingFor();
            }

            analyzed = await this._thingtalkHandler.analyzeCommand(await this.nextCommand());
        }
        return analyzed.answer;
    }
    private async _resendChoices() {
        if (this.expecting !== ValueCategory.MultipleChoice)
            console.log('UNEXPECTED: sendChoice while not expecting a MultipleChoice');

        for (let idx = 0; idx < this.choices.length; idx++)
            await this.conversation.sendChoice(idx, this.choices[idx]);
    }

    async replyInterp(msg : string, args ?: Record<string, unknown>, icon : string|null = null) {
        if (args === undefined)
            return this.reply(msg, icon);
        else
            return this.reply(this.interpolate(msg, args), icon);
    }

    async reply(msg : string, icon ?: string|null) {
        this.conversation.updateLog('agent', msg);
        await this.conversation.sendReply(msg, icon || this.icon);
    }

    async replyGeneric(message : string|Tp.FormatObjects.FormattedObject, icon ?: string|null) {
        if (typeof message === 'string')
            await this.reply(message, icon);
        else if (message.type === 'text')
            await this.reply(message.text, icon);
        else if (message.type === 'picture' || message.type === 'audio' || message.type === 'video')
            await this.conversation.sendMedia(message.type, message.url, message.alt, icon || this.icon);
        else if (message.type === 'rdl')
            await this.conversation.sendRDL(message, icon || this.icon);
        else if (message.type === 'sound')
            await this.conversation.sendSoundEffect(message.name, message.exclusive, icon || this.icon);
        else if (message.type === 'button')
            await this.conversation.sendButton(message.title, message.json);
    }

    async replyButton(text : string, json : string) {
        await this.conversation.sendButton(text, json);
    }

    async replyLink(title : string, url : string, state : ConversationState = this.conversation.getState()) {
        await this.conversation.sendLink(title, url, state);
    }

    private _isInDefaultState() : boolean {
        return this._notifyQueue.hasWaiter();
    }

    dispatchNotify(app : AppExecutor, outputType : string, outputValue : Record<string, unknown>) {
        const item = new QueueItem.Notification(app, outputType, outputValue);
        this._pushQueueItem(item);
    }
    dispatchNotifyError(app : AppExecutor, error : Error) {
        const item = new QueueItem.Error(app, error);
        this._pushQueueItem(item);
    }

    async _tryLoop(showWelcome : boolean, initialState : Record<string, unknown>|null) {
        while (!this._stopped) {
            try {
                await this._loop(showWelcome, initialState);
            } catch(e) {
                console.error('Uncaught error in dialog loop', e);
                // loop
            }
            showWelcome = false;
            initialState = null;
        }
    }

    async start(showWelcome : boolean, initialState : Record<string, unknown>|null) {
        await this._nlu.start();
        await this._nlg.start();
        this._dynamicHandlers.start();

        const promise = this._waitNextCommand();
        this._tryLoop(showWelcome, initialState);
        return promise;
    }

    async stop() {
        this._stopped = true;

        // wait until the dialog is ready to accept commands, then inject
        // a cancellation error
        await this._mgrPromise;
        assert(this._mgrPromise === null);

        if (this._isInDefaultState())
            this._notifyQueue.cancelWait(new CancellationError());
        else
            this._userInputQueue.cancelWait(new CancellationError());

        this._dynamicHandlers.stop();
        await this._nlu.stop();
        await this._nlg.stop();
    }

    async reset() {
        // wait until the dialog is ready to accept commands
        await this._mgrPromise;
        assert(this._mgrPromise === null);

        if (this._isInDefaultState())
            this._notifyQueue.cancelWait(new CancellationError());
        else
            this._userInputQueue.cancelWait(new CancellationError());
    }

    private _pushQueueItem(item : QueueItem) {
        // ensure that we have something to wait on before the next
        // command is handled
        if (!this._mgrPromise)
            this._waitNextCommand();

        this._notifyQueue.push(item);
    }

    /**
     * Returns a promise that will resolve when the dialogue loop is
     * ready to accept the next command from the user.
     */
    private _waitNextCommand() : Promise<void> {
        const promise = new Promise<void>((callback) => {
            this._mgrResolve = callback;
        });
        this._mgrPromise = promise;
        return promise;
    }

    pushCommand(command : UserInput) {
        this._pushQueueItem(new QueueItem.UserInput(command));
    }

    async handleCommand(command : UserInput) : Promise<void> {
        // wait until the dialog is ready to accept commands
        await this._mgrPromise;
        assert(this._mgrPromise === null);

        const promise = this._waitNextCommand();

        if (this._isInDefaultState())
            this.pushCommand(command);
        else
            this._userInputQueue.push(command);

        return promise;
    }

    async executeStatement(stmt : any) {
        const [results,] = await this._agent.executor.executeStatement(stmt, undefined, undefined);
        const promise = this._waitNextCommand();
        return { results : results, promise : promise };
    }
}

export function pickHandler(currentHandler : DialogueHandler<CommandAnalysisResult, any> | null,
                            expecting : ValueCategory|null,
                            handlerCandidates : Array<{ handler : DialogueHandler<CommandAnalysisResult, any>; analysis : CommandAnalysisResult; }>,
                            command : UserInput,
                            debug = false) : [DialogueHandler<any, any>|undefined, CommandAnalysisResult]  {
    let best : DialogueHandler<any, any>|undefined = undefined;
    let bestanalysis : CommandAnalysisResult|undefined = undefined;
    let bestconfidence = Confidence.NO;

    // If "expecting === null",
    //   this algorithm will choose the dialogue handlers that reports:
    //   - the highest confidence
    //   - if a tie, the highest priority
    //   - if a tie, the current handler
    //   - if a tie, the first handler that reports any confidence at all
    //
    // If "expecting !== null",
    //   this algorithm will choose the current handler, unless one of the following
    //   is true:
    //   - some other handler returns exact_in_domain_command (or similar exact level type)
    //     and it's either higher priority or higher confidence than the current handler
    //   - the current handler returns out_of_domain

    if (debug) {
        for (const handlerItem of handlerCandidates) {
            const handler = handlerItem.handler;
            const analysis = handlerItem.analysis;
            console.log(`Handler ${handler.uniqueId} reports ${CommandAnalysisType[analysis.type]}`);
        }
    }

    if (expecting !== null && currentHandler !== null) {
        const currentAnalysis = handlerCandidates.find((cand) => cand.handler === currentHandler)!.analysis;
        if (currentAnalysis.type !== CommandAnalysisType.OUT_OF_DOMAIN_COMMAND) {
            let best : DialogueHandler<any, any>|undefined = undefined;
            let bestanalysis : CommandAnalysisResult|undefined = undefined;

            for (const handlerItem of handlerCandidates) {
                const handler = handlerItem.handler;
                const analysis = handlerItem.analysis;

                switch (analysis.type) {
                case CommandAnalysisType.STOP:
                case CommandAnalysisType.DEBUG:
                case CommandAnalysisType.NEVERMIND:
                case CommandAnalysisType.WAKEUP:
                case CommandAnalysisType.EXACT_IN_DOMAIN_COMMAND:
                    if (best === undefined ||
                        (
                            handler.priority > best.priority ||
                            (currentHandler === handler && handler.priority >= best.priority)
                        )) {
                        best = handler;
                        bestanalysis = analysis;
                    }
                    break;

                default:
                    // ignore this handler
                }
            }

            if (best)
                return [best, bestanalysis!];

            return [currentHandler, currentAnalysis];
        }

        // fallthrough to the expecting === null case
    }

    for (const handlerItem of handlerCandidates) {
        const handler = handlerItem.handler;
        const analysis = handlerItem.analysis;

        switch (analysis.type) {
        case CommandAnalysisType.STOP:
        case CommandAnalysisType.DEBUG:
        case CommandAnalysisType.NEVERMIND:
        case CommandAnalysisType.WAKEUP:
        case CommandAnalysisType.EXACT_IN_DOMAIN_COMMAND:
                // choose if either
                // - we're higher priority
                // - we're more confident
            if (best === undefined ||
                    (
                        bestconfidence < Confidence.ABSOLUTE ||
                        handler.priority > best.priority ||
                        (currentHandler === handler && handler.priority >= best.priority)
                    )) {
                best = handler;
                bestanalysis = analysis;
                bestconfidence = Confidence.ABSOLUTE;
            }
            break;

        case CommandAnalysisType.STRONGLY_CONFIDENT_IN_DOMAIN_COMMAND:
                // choose if either
                // - we're higher priority
                // - we're more confident
                // - we're the current dialogue and we have the same priority
            if (best === undefined ||
                    (
                        bestconfidence < Confidence.HIGH ||
                        (bestconfidence <= Confidence.HIGH && handler.priority > best.priority) ||
                        (bestconfidence <= Confidence.HIGH && handler.priority >= best.priority && currentHandler === handler)
                    )) {
                best = handler;
                bestanalysis = analysis;
                bestconfidence = Confidence.HIGH;
            }
            break;

        case CommandAnalysisType.CONFIDENT_IN_DOMAIN_COMMAND:
                // choose if either
                // - we're higher priority
                // - we're more confident
                // - we're the current dialogue and we have the same priority
            if (best === undefined ||
                    (
                        bestconfidence < Confidence.NORMAL ||
                        (bestconfidence <= Confidence.NORMAL && handler.priority > best.priority) ||
                        (bestconfidence <= Confidence.NORMAL && handler.priority >= best.priority && currentHandler === handler)
                    )) {
                best = handler;
                bestanalysis = analysis;
                bestconfidence = Confidence.NORMAL;
            }
            break;

        case CommandAnalysisType.NONCONFIDENT_IN_DOMAIN_COMMAND:
                // choose if both:
                // - we're higher priority (same if we're the current dialogue)
                // - we're as confident
            if (best === undefined ||
                    ((handler.priority > best.priority ||
                    (currentHandler === handler &&
                    handler.priority >= best.priority)) &&
                    bestconfidence <= Confidence.LOW)) {
                best = handler;
                bestanalysis = analysis;
                bestconfidence = Confidence.LOW;
            }
            break;

        case CommandAnalysisType.EXACT_IN_DOMAIN_FOLLOWUP:
            if (currentHandler === handler &&
                    (
                        best === undefined ||
                        bestconfidence < Confidence.ABSOLUTE ||
                        handler.priority > best.priority
                    )) {
                best = handler;
                bestanalysis = analysis;
                bestconfidence = Confidence.ABSOLUTE;
            }
            break;

        case CommandAnalysisType.STRONGLY_CONFIDENT_IN_DOMAIN_FOLLOWUP:
                // choose if handler is the current handler and either
                // - we're same priority
                // - we're more confident
            if (currentHandler === handler &&
                    (best === undefined ||
                    handler.priority >= best.priority ||
                    bestconfidence < Confidence.HIGH)) {
                best = handler;
                bestanalysis = analysis;
                bestconfidence = Confidence.HIGH;
            }
            break;

        case CommandAnalysisType.CONFIDENT_IN_DOMAIN_FOLLOWUP:
                // choose if handler is the current handler and either
                // - we're same priority
                // - we're more confident
            if (currentHandler === handler &&
                    (best === undefined ||
                    handler.priority >= best.priority ||
                    bestconfidence < Confidence.NORMAL)) {
                best = handler;
                bestanalysis = analysis;
                bestconfidence = Confidence.NORMAL;
            }
            break;

        case CommandAnalysisType.NONCONFIDENT_IN_DOMAIN_FOLLOWUP:
                // choose if handler is the current handler and either
                // - we're same priority
                // - we're as confident
            if (currentHandler === handler &&
                    (best === undefined ||
                    (handler.priority >= best.priority && bestconfidence <= Confidence.LOW))) {
                best = handler;
                bestanalysis = analysis;
                bestconfidence = Confidence.LOW;
            }
            break;

        default:
            // ignore this handler, which decided the command is out of domain
        }
    }


    return [best,
            bestanalysis ||
            { type: CommandAnalysisType.OUT_OF_DOMAIN_COMMAND,
              utterance: command.type === 'command' ? command.utterance : command.parsed.prettyprint(),
              user_target: '$failed;' }];
}
