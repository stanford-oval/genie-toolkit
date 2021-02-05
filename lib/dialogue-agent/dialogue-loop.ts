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
const Ast = ThingTalk.Ast;
import interpolate from 'string-interp';
import AsyncQueue from 'consumer-queue';

import { getProgramIcon } from '../utils/icons';
import ValueCategory from './value-category';
import QueueItem from './dialogue_queue';
import UserInput, { PlatformData } from './user-input';
import { CancellationError } from './errors';

import * as Helpers from './helpers';
import { computePrediction, computeNewState, prepareContextForPrediction } from './dialogue_state_utils';
import DialoguePolicy from './dialogue_policy';
import type Conversation from './conversation';
import type Engine from '../engine';
import TextFormatter from './card-output/text-formatter';
import CardFormatter, { FormattedChunk } from './card-output/card-formatter';

import ExecutionDialogueAgent from './execution_dialogue_agent';

const ENABLE_SUGGESTIONS = false;

// TODO: load the policy.yaml file instead
const POLICY_NAME = 'org.thingpedia.dialogue.transaction';
const TERMINAL_STATES = [
    'sys_end', 'sys_action_success'
];

export default class DialogueLoop {
    conversation : Conversation;
    engine : Engine;
    private _textFormatter : TextFormatter;
    private _cardFormatter : CardFormatter;

    private _userInputQueue : AsyncQueue<UserInput>;
    private _notifyQueue : AsyncQueue<QueueItem>;
    private _prefs : Tp.Preferences;
    private _agent : ExecutionDialogueAgent;
    private _policy : DialoguePolicy;
    private _debug : boolean;

    icon : string|null;
    expecting : ValueCategory|null;
    platformData : PlatformData;
    private _dialogueState : ThingTalk.Ast.DialogueState|null;
    private _executorState : undefined;
    private _lastNotificationApp : string|undefined;

    private _mgrResolve : (() => void)|null;
    private _mgrPromise : Promise<void>|null;

    constructor(conversation : Conversation,
                engine : Engine,
                debug : boolean) {
        this._userInputQueue = new AsyncQueue();
        this._notifyQueue = new AsyncQueue();

        this._debug = debug;
        this.conversation = conversation;
        this.engine = engine;
        this._prefs = engine.platform.getSharedPreferences();
        this._textFormatter = new TextFormatter(engine.platform.locale, engine.platform.timezone, engine.schemas, engine._);
        this._cardFormatter = new CardFormatter(engine.platform.locale, engine.platform.timezone, engine.schemas, engine._);
        this.icon = null;
        this.expecting = null;
        this.platformData = {};

        this._mgrResolve = null;
        this._mgrPromise = null;

        this._agent = new ExecutionDialogueAgent(engine, this, debug);
        this._policy = new DialoguePolicy({
            thingpedia: conversation.thingpedia,
            schemas: conversation.schemas,
            locale: conversation.locale,
            rng: conversation.rng,
            debug : this._debug
        });
        this._dialogueState = null; // thingtalk dialogue state
        this._executorState = undefined; // private object managed by DialogueExecutor
        this._lastNotificationApp = undefined;
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

    debug(...args : unknown[]) {
        if (!this._debug)
            return;
        console.log(...args);
    }

    interpolate(msg : string, args : Record<string, unknown>) : string {
        return interpolate(msg, args, {
            locale: this.conversation.locale,
            timezone: this.conversation.timezone
        })||'';
    }

    async nextIntent() : Promise<UserInput> {
        await this.conversation.sendAskSpecial();
        this._mgrPromise = null;
        this._mgrResolve!();
        const intent = await this._userInputQueue.pop();
        this.platformData = intent.platformData;
        return intent;
    }

    private _checkPolicy(policyName : string) {
        if (policyName !== POLICY_NAME) {
            // TODO we should download the policy from Thingpedia
            throw new Error(`Invalid dialogue policy ${policyName}`);
        }
    }

    private async _handleUICommand(intent : UserInput.UICommand) {
        switch (intent.type) {
        case 'stop':
            // stop means cancel, but without a failure message
            throw new CancellationError();

        case 'nevermind':
            await this.reply(this._("Sorry I couldn't help on that."));
            throw new CancellationError();

        case 'debug':
            await this.reply("Current State:\n" + (this._dialogueState ? this._dialogueState.prettyprint() : "null"));
            break;

        case 'wakeup':
            // nothing to do
            break;

        default:
            await this.fail();
        }
    }

    private async _getFallbackExamples(command : string) {
        const dataset = await this.conversation.thingpedia.getExamplesByKey(command);
        const examples = ENABLE_SUGGESTIONS ? await Helpers.loadExamples(dataset, this.conversation.schemas, 5) : [];

        if (examples.length === 0) {
            await this.reply(this._("Sorry, I did not understand that."));
            return;
        }

        this.conversation.stats.hit('sabrina-fallback-buttons');

        // don't sort the examples, they come already sorted from Thingpedia

        await this.reply(this._("Sorry, I did not understand that. Try the following instead:"));
        for (const ex of examples)
            this.replyButton(Helpers.presentExample(this, ex.utterance), JSON.stringify(ex.target));
    }

    private async _computePrediction(intent : UserInput) : Promise<ThingTalk.Ast.DialogueState|null> {
        // handle all intents generated internally and by the UI:
        //
        // - Failed when parsing fails
        // - Answer when the user clicks a button, or when the agent is in "raw mode"
        // - NeverMind when the user clicks the X button
        // - Debug when the user clicks/types "debug"
        // - WakeUp when the user says the wake word and nothing else
        if (intent instanceof UserInput.Failed) {
            await this._getFallbackExamples(intent.utterance);
            return null;
        }
        if (intent instanceof UserInput.Unsupported) {
            this.icon = null;
            await this.reply(this._("Sorry, I don't know how to do that yet."));
            throw new CancellationError();
        }
        if (intent instanceof UserInput.Answer) {
            const handled = await this._policy.handleAnswer(this._dialogueState, intent.value);
            if (!handled) {
                await this.fail();
                return null;
            }
            return computePrediction(this._dialogueState, handled, 'user');
        }
        if (intent instanceof UserInput.MultipleChoiceAnswer) {
            await this.fail();
            return null;
        }

        if (intent instanceof UserInput.Program) {
            // convert thingtalk programs to dialogue states so we can use "\t" without too much typing
            const prediction = new Ast.DialogueState(null, 'org.thingpedia.dialogue.transaction', 'execute', null, []);
            for (const stmt of intent.program.statements) {
                if (stmt instanceof Ast.Assignment)
                    throw new Error(`Unsupported: assignment statement`);
                prediction.history.push(new Ast.DialogueHistoryItem(null, stmt, null, 'accepted'));
            }
            return prediction;
        }

        if (intent instanceof UserInput.UICommand) {
            await this._handleUICommand(intent);
            return null;
        }

        assert(intent instanceof UserInput.DialogueState);
        return intent.prediction;
    }

    private _useNeuralNLG() : boolean {
        return this._prefs.get('experimental-use-neural-nlg') as boolean;
    }

    private async _doAgentReply() : Promise<[ValueCategory|null, number]> {
        const oldState = this._dialogueState;

        const policyResult = await this._policy.chooseAction(this._dialogueState);
        if (!policyResult) {
            await this.fail();
            throw new CancellationError();
        }

        let expect, utterance, numResults;
        if (this._useNeuralNLG()) {
            [this._dialogueState, expect, , numResults] = policyResult;

            const policyPrediction = computeNewState(oldState, this._dialogueState, 'agent');
            this.debug(`Agent act:`);
            this.debug(policyPrediction.prettyprint());

            const context = prepareContextForPrediction(oldState, 'agent');
            await this.conversation.setContext(context);

            utterance = await this.conversation.generateAnswer(policyPrediction);
        } else {
            [this._dialogueState, expect, utterance, numResults] = policyResult;
        }

        this.icon = getProgramIcon(this._dialogueState!);
        await this.reply(utterance);
        if (expect === null && TERMINAL_STATES.includes(this._dialogueState!.dialogueAct))
            throw new CancellationError();

        await this.setExpected(expect);
        return [expect, numResults];
    }

    private async _handleUserInput(intent : UserInput) {
        for (;;) {
            const prediction = await this._computePrediction(intent);
            if (prediction === null) {
                intent = await this.nextIntent();
                continue;
            }
            this._dialogueState = computeNewState(this._dialogueState, prediction, 'user');
            this._checkPolicy(this._dialogueState.policy);
            this.icon = getProgramIcon(this._dialogueState);

            //this.debug(`Before execution:`);
            //this.debug(this._dialogueState.prettyprint());

            const { newDialogueState, newExecutorState, newResults } = await this._agent.execute(this._dialogueState, this._executorState);
            this._dialogueState = newDialogueState;
            this._executorState = newExecutorState;
            this.debug(`Execution state:`);
            this.debug(this._dialogueState!.prettyprint());

            const [expect, numResults] = await this._doAgentReply();

            for (const [outputType, outputValue] of newResults.slice(0, numResults)) {
                const formatted = await this._cardFormatter.formatForType(outputType, outputValue, { removeText: true });

                for (const card of formatted)
                    await this.replyCard(card);
            }

            if (expect === null)
                return;

            intent = await this.nextIntent();
        }
    }

    private async _showNotification(appId : string,
                                    icon : string|null,
                                    outputType : string,
                                    outputValue : Record<string, unknown>) {
        let app;
        if (appId !== undefined)
            app = this.conversation.apps.getApp(appId);
        else
            app = undefined;

        const messages = await this._textFormatter.formatForType(outputType, outputValue, 'messages');
        if (app !== undefined && app.isRunning && appId !== this._lastNotificationApp &&
            (messages.length === 1 && typeof messages[0] === 'string')) {
            await this.replyInterp(this._("Notification from ${app}: ${message}"), {
                app: app.name,
                message: messages[0]
            }, icon);
        } else {
            if (app !== undefined && app.isRunning && appId !== this._lastNotificationApp)
                await this.replyInterp(this._("Notification from ${app}"), { app: app.name }, icon);
            for (const msg of messages)
                await this.replyCard(msg, icon);
        }
    }

    private async _showAsyncError(appId : string,
                                  icon : string|null,
                                  error : Error) {
        let app;
        if (appId !== undefined)
            app = this.conversation.apps.getApp(appId);
        else
            app = undefined;

        const errorMessage = Helpers.formatError(this, error);
        console.log('Error from ' + appId, error);

        if (app !== undefined && app.isRunning)
            await this.replyInterp(this._("${app} had an error: ${error}."), { app: app.name, error: errorMessage }, icon);
        else
            await this.replyInterp(this._("Sorry, that did not work: ${error}."), { error: errorMessage }, icon);
    }

    private async _handleAPICall(call : QueueItem) {
        if (call instanceof QueueItem.Notification) {
            await this._showNotification(call.appId, call.icon, call.outputType, call.outputValue);
            this._lastNotificationApp = call.appId;
        } else if (call instanceof QueueItem.Error) {
            await this._showAsyncError(call.appId, call.icon, call.error);
            this._lastNotificationApp = call.appId;
        }
    }

    private async _loop(showWelcome : boolean) {
        // if we want to show the welcome message, we run the policy on the `null` state, which will return the sys_greet intent
        if (showWelcome) {
            await this._doAgentReply();
            // reset the dialogue state here; if we don't, we we'll see sys_greet as an agent
            // dialogue act; this is never seen in training, because in training the user speaks
            // first, so it confuses the neural network
            this._dialogueState = null;
            // the utterance ends with "what can i do for you?", which is expect = 'generic'
            // but we don't want to keep the microphone open here, we want to go back to wake-word mode
            // so we unconditionally close the round here
            await this.setExpected(null);
        }

        for (;;) {
            const item = await this.nextQueueItem();
            try {
                if (item instanceof QueueItem.UserInput) {
                    this._lastNotificationApp = undefined;
                    await this._handleUserInput(item.intent);
                } else {
                    await this._handleAPICall(item);
                    this._dialogueState = null;
                }
            } catch(e) {
                if (e.code === 'ECANCELLED') {
                    await this.reset();
                } else {
                    if (item instanceof QueueItem.UserInput) {
                        await this.replyInterp(this._("Sorry, I had an error processing your command: ${error}."), {//"
                            error: Helpers.formatError(this, e)
                        });
                    } else {
                        await this.replyInterp(this._("Sorry, that did not work: ${error}."), {
                            error: Helpers.formatError(this, e)
                        });
                    }
                    console.error(e);
                }
            }
        }
    }

    get dialogueState() : ThingTalk.Ast.DialogueState|null {
        return this._dialogueState;
    }

    set dialogueState(newState : ThingTalk.Ast.DialogueState|null) {
        this._dialogueState = newState;
    }

    async nextQueueItem() : Promise<QueueItem> {
        this.setExpected(null);
        await this.conversation.sendAskSpecial();
        this._mgrPromise = null;
        this._mgrResolve!();
        const queueItem = await this._notifyQueue.pop();
        if (queueItem instanceof QueueItem.UserInput)
            this.platformData = queueItem.intent.platformData;
        else
            this.platformData = {};
        return queueItem;
    }

    async lookingFor() {
        if (this.expecting === null) {
            await this.reply(this._("In fact, I did not ask for anything at all!"));
        } else if (this.expecting === ValueCategory.YesNo) {
            await this.reply(this._("Sorry, I need you to confirm the last question first."));
        } else if (this.expecting === ValueCategory.MultipleChoice) {
            await this.reply(this._("Could you choose one of the following?"));
            this.conversation.resendChoices();
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
            // ValueCategory.RawString puts Almond in raw mode,
            // so we accept almost everything
            // but this will happen if the user clicks a button
            // or upload a picture
            await this.reply(this._("Which is interesting, because I'll take anything at all. Just type your mind!"));
        } else if (this.expecting === ValueCategory.Command) {
            await this.reply(this._("I'm looking for a command."));
        } else {
            await this.reply(this._("In fact, I'm not even sure what I asked. Sorry!"));
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
        const context = prepareContextForPrediction(this._dialogueState, 'user');
        this.conversation.setContext(context);
        this.conversation.setExpected(expected, raw);
    }

    /**
     * Ask a question to the user.
     *
     * This is a legacy method used for certain scripted interactions.
     */
    async ask(expected : ValueCategory.PhoneNumber|ValueCategory.EmailAddress|ValueCategory.Location|ValueCategory.Time,
              question : string,
              args ?: Record<string, unknown>) : Promise<ThingTalk.Ast.Value> {
        await this.replyInterp(question, args);
        // force the question to occur in raw mode for locations
        // because otherwise we send it to the parser and the parser will
        // likely misbehave as it's a state that we've never seen in training
        await this.setExpected(expected, expected === ValueCategory.Location);
        let intent = await this.nextIntent();
        while (!(intent instanceof UserInput.Answer) || intent.category !== expected) {
            if (intent instanceof UserInput.UICommand)
                await this._handleUICommand(intent);
            else
                await this.fail();
            intent = await this.nextIntent();
        }
        return intent.value;
    }
    async askChoices(question : string, choices : string[]) : Promise<number> {
        await this.reply(question);
        this.setExpected(ValueCategory.MultipleChoice);
        for (let i = 0; i < choices.length; i++)
            await this.replyChoice(i, choices[i]);
        let intent = await this.nextIntent();
        while (!(intent instanceof UserInput.MultipleChoiceAnswer)) {
            if (intent instanceof UserInput.UICommand)
                await this._handleUICommand(intent);
            else
                await this.fail();
            intent = await this.nextIntent();
        }
        return intent.value;
    }

    async reset() {
        this.icon = null;
        this._dialogueState = null;
        await this.setExpected(null);
    }

    async replyInterp(msg : string, args ?: Record<string, unknown>, icon : string|null = null) {
        if (args === undefined)
            return this.reply(msg, icon);
        else
            return this.reply(this.interpolate(msg, args), icon);
    }

    async reply(msg : string, icon ?: string|null) {
        await this.conversation.sendReply(msg, icon || this.icon);
    }

    async replyCard(message : FormattedChunk, icon ?: string|null) {
        if (typeof message === 'string') {
            await this.reply(message, icon);
        } else if (message.type === 'picture') {
            if (message.url === undefined)
                return;
            await this.conversation.sendPicture(message.url, icon || this.icon);
        } else if (message.type === 'rdl') {
            await this.conversation.sendRDL(message, icon || this.icon);
        } else if (message.type === 'button') {
            const loaded = await Helpers.loadSuggestedProgram(message.code, this.conversation.schemas);
            await this.replyButton(message.title, JSON.stringify(loaded));
        } else {
            await this.conversation.sendResult(message, icon || this.icon);
        }
    }

    async replyChoice(idx : number, title : string) {
        await this.conversation.sendChoice(idx, title);
    }

    async replyButton(text : string, json : string) {
        await this.conversation.sendButton(text, json);
    }

    async replyLink(title : string, url : string) {
        await this.conversation.sendLink(title, url);
    }

    private _isInDefaultState() : boolean {
        return this._notifyQueue.hasWaiter();
    }

    dispatchNotify(appId : string, icon : string|null, outputType : string, outputValue : Record<string, unknown>) {
        const item = new QueueItem.Notification(appId, icon, outputType, outputValue);
        this._pushQueueItem(item);
    }
    dispatchNotifyError(appId : string, icon : string|null, error : Error) {
        const item = new QueueItem.Error(appId, icon, error);
        this._pushQueueItem(item);
    }

    start(showWelcome : boolean) {
        const promise = this._waitNextIntent();
        this._loop(showWelcome).then(() => {
            throw new Error('Unexpected end of dialog loop');
        }, (err) => {
            console.error('Uncaught error in dialog loop', err);
            throw err;
        });
        return promise;
    }

    private _pushQueueItem(item : QueueItem) {
        // ensure that we have something to wait on before the next
        // command is handled
        if (!this._mgrPromise)
            this._waitNextIntent();

        this._notifyQueue.push(item);
    }

    private _waitNextIntent() : Promise<void> {
        const promise = new Promise<void>((callback, errback) => {
            this._mgrResolve = callback;
        });
        this._mgrPromise = promise;
        return promise;
    }

    pushIntent(intent : UserInput, confident = false) {
        this._pushQueueItem(new QueueItem.UserInput(intent, confident));
    }

    async handle(intent : UserInput, confident = false) : Promise<void> {
        // wait until the dialog is ready to accept commands
        await this._mgrPromise;
        assert(this._mgrPromise === null);

        const promise = this._waitNextIntent();

        if (this._isInDefaultState())
            this.pushIntent(intent, confident);
        else
            this._userInputQueue.push(intent);

        return promise;
    }
}
