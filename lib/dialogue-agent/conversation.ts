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


import * as events from 'events';
import interpolate from 'string-interp';
import type * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';

import * as I18n from '../i18n';
import * as ParserClient from '../prediction/parserclient';

import UserInput, { PlatformData } from './user-input';
import ValueCategory from './value-category';
import DialogueLoop from './dialogue-loop';
import { MessageType, Message, RDL } from './protocol';
import { EntityMap } from '../utils/entity-utils';
import * as ThingTalkUtils from '../utils/thingtalk';
import type Engine from '../engine';

const DummyStatistics = {
    hit() {
    }
};

const DEFAULT_CONVERSATION_TTL = 600000; // 10 minutes

export interface AssistantUser {
    id : string;
    account : string;
}

export interface ConversationOptions {
    nluServerUrl ?: string;
    nlgServerUrl ?: string;
    anonymous ?: boolean;
    debug ?: boolean;
    rng ?: () => number;
    inactivityTimeout ?: number;
    contextResetTimeout ?: number;
    showWelcome ?: boolean;
    deleteWhenInactive ?: boolean;
}

interface Statistics {
    hit(key : string) : void;
}

interface Context {
    code : string[];
    entities : EntityMap;
}

export interface ConversationDelegate {
    setHypothesis(hyp : string) : void;
    setExpected(expect : string|null, ctx : Context) : void;
    addMessage(msg : Message) : Promise<void>;
}

interface SetContextOptions {
    explicitStrings ?: boolean;
}

interface ResultLike {
    toLocaleString(locale ?: string) : string;
}

interface PredictionCandidate {
    target : UserInput;
    score : number|'Infinity';
}

export default class Conversation extends events.EventEmitter {
    private _engine : Engine;
    private _user : AssistantUser;
    private _conversationId : string;
    private _locale : string;
    _ : (x : string) => string;

    private _stats : Statistics;
    private _options : ConversationOptions;
    private _debug : boolean;
    rng : () => number;
    private _prefs : Tp.Preferences;
    private _nlu : ParserClient.ParserClient;
    private _nlg : ParserClient.ParserClient;

    private _raw : boolean;
    private _lastCommand : ParserClient.PredictionResult|null;
    private _lastCandidates : PredictionCandidate[]|null;

    private _loop : DialogueLoop;
    private _expecting : ValueCategory|null;
    private _context : Context;
    private _choices : string[];

    private _delegates : Set<ConversationDelegate>;
    private _history : Message[];
    private _nextMsgId : number;
    private _inactivityTimeout : NodeJS.Timeout|null;
    private _inactivityTimeoutSec : number;
    private _contextResetTimeout : NodeJS.Timeout|null;
    private _contextResetTimeoutSec : number;

    constructor(engine : Engine,
                conversationId : string,
                user : AssistantUser,
                options : ConversationOptions = {}) {
        super();
        this._engine = engine;
        this._user = user;

        this._conversationId = conversationId;
        this._locale = this._engine.platform.locale;
        this._ = I18n.get(this._locale).gettext;

        const stats = this._engine.platform.getCapability('statistics');
        if (stats === null)
            this._stats = DummyStatistics;
        else
            this._stats = stats;

        this._raw = false;
        this._options = options;
        this._debug = !!this._options.debug;

        this.rng = options.rng || Math.random;

        this._prefs = engine.platform.getSharedPreferences();
        this._nlu = ParserClient.get(this._options.nluServerUrl, engine.platform.locale, engine.platform,
            undefined, engine.thingpedia);
        if (this._options.nlgServerUrl)
            this._nlg = ParserClient.get(this._options.nlgServerUrl, engine.platform.locale, engine.platform);
        else
            this._nlg = this._nlu;
        this._lastCommand = null;
        this._lastCandidates = null;

        this._loop = new DialogueLoop(this, this._engine, this._debug);
        this._choices = [];
        this._expecting = null;
        this._context = {
            code: [],
            entities: {}
        };
        this.setContext(null);
        this._delegates = new Set;
        this._history = [];
        this._nextMsgId = 0;

        this._inactivityTimeout = null;
        this._inactivityTimeoutSec = options.inactivityTimeout || DEFAULT_CONVERSATION_TTL;
        this._contextResetTimeout = null;
        this._contextResetTimeoutSec = options.contextResetTimeout || this._inactivityTimeoutSec;
    }

    get isAnonymous() : boolean {
        return !!this._options.anonymous;
    }

    get id() : string {
        return this._conversationId;
    }

    get user() : AssistantUser {
        return this._user;
    }

    get platform() : Tp.BasePlatform {
        return this._engine.platform;
    }

    get locale() : string {
        return this._engine.platform.locale;
    }

    get timezone() : string {
        return this._engine.platform.timezone;
    }

    get stats() : Statistics {
        return this._stats;
    }

    get apps() {
        return this._engine.apps;
    }

    get schemas() : ThingTalk.SchemaRetriever {
        return this._engine.schemas;
    }

    get thingpedia() : Tp.BaseClient {
        return this._engine.thingpedia;
    }

    get history() : Message[] {
        return this._history;
    }

    notify(appId : string, icon : string|null, outputType : string, outputValue : Record<string, unknown>) {
        return this._loop.dispatchNotify(appId, icon, outputType, outputValue);
    }

    notifyError(appId : string, icon : string|null, error : Error) {
        return this._loop.dispatchNotifyError(appId, icon, error);
    }

    expect(expecting : ValueCategory|null) : void {
        this._expecting = expecting;
        this._choices = [];
        this._raw = (expecting === ValueCategory.RawString || expecting === ValueCategory.Password);
    }

    async start() : Promise<void> {
        await this._nlu.start();
        if (this._nlu !== this._nlg)
            await this._nlg.start();
        this._resetInactivityTimeout();
        return this._loop.start(!!this._options.showWelcome);
    }

    async stop() : Promise<void> {
        await this._nlu.stop();
        if (this._nlu !== this._nlg)
            await this._nlg.stop();
    }

    private _isUnsupportedError(e : Error) : boolean {
        // FIXME there should be a better way to do this

        // 'xxx has no actions yyy' or 'xxx has no queries yyy'
        // quite likely means that the NN worked but it produced a device that
        // was not approved yet (otherwise the NN itself would catch the invalid function and
        // skip this result) and we don't have the necessary developer key
        // in that case, we reply to the user that the command is unsupported
        return /(invalid kind| has no (quer(ies|y)|actions?)) /i.test(e.message);
    }

    // set confident = true only if
    // 1) we are not dealing with natural language (code, gui, etc), or
    // 2) we find an exact match
    private _doHandleCommand(intent : UserInput,
                             analyzed : ParserClient.PredictionResult|null,
                             candidates : PredictionCandidate[],
                             confident=false) {
        this._lastCommand = analyzed;
        this._lastCandidates = candidates;
        return this._loop.handle(intent, confident);
    }

    private _getContext(currentCommand : string|null, platformData : PlatformData) {
        return {
            command: currentCommand,
            previousCommand: this._lastCommand,
            previousCandidates: this._lastCandidates,
            platformData: platformData
        };
    }

    setContext(context : ThingTalk.Ast.DialogueState|null, options : SetContextOptions = {}) {
        if (context === null) {
            this._context = {
                code: ['null'],
                entities: {}
            };
        } else {
            const [code, entities] = ThingTalkUtils.serializeNormalized(context);
            this._context = { code, entities };
        }
    }

    async generateAnswer(policyPrediction : ThingTalk.Ast.DialogueState) : Promise<string> {
        const [targetAct,] = ThingTalkUtils.serializeNormalized(policyPrediction, this._context.entities);
        const result = await this._nlg.generateUtterance(this._context.code, this._context.entities, targetAct);
        return result[0].answer;
    }

    private async _continueHandleCommand(command : string,
                                         analyzed : ParserClient.PredictionResult,
                                         platformData : PlatformData) : Promise<void> {
        // parse all code sequences into an Intent
        // this will correctly filter out anything that does not parse
        if (analyzed.candidates.length > 0)
            console.log('Analyzed message into ' + analyzed.candidates[0].code.join(' '));
        else
            console.log('Failed to analyze message');
        const candidates = await Promise.all(analyzed.candidates.map(async (candidate, beamposition) => {
            let parsed;
            try {
                parsed = await UserInput.parse({ code: candidate.code, entities: analyzed.entities },
                    this.thingpedia, this.schemas, this._getContext(command, platformData));
            } catch(e) {
                // Likely, a type error in the ThingTalk code; not a big deal, but we still log it
                console.log(`Failed to parse beam ${beamposition}: ${e.message}`);

                if (this._isUnsupportedError(e))
                    parsed = new UserInput.Unsupported(platformData);
                else
                    return null;
            }
            return { target: parsed, score: candidate.score };
        })).then((candidates) => candidates.filter(<T>(c : T) : c is Exclude<T, null> => c !== null));

        // here we used to do a complex heuristic dance of probabilities and confidence scores
        // we do none of that, because Almond-NNParser does not give us useful scores

        if (candidates.length > 0) {
            let i = 0;
            let choice = candidates[i];
            while (i < candidates.length-1 && choice.target instanceof UserInput.Unsupported && choice.score === 'Infinity') {
                i++;
                choice = candidates[i];
            }

            this.stats.hit('sabrina-command-good');
            const confident = choice.score === 'Infinity';
            return this._doHandleCommand(choice.target, analyzed, candidates, confident);
        } else {
            this._lastCommand = analyzed;
            this._lastCandidates = candidates;

            this.stats.hit('sabrina-failure');
            return this._loop.handle(new UserInput.Failed(command, platformData));
        }
    }

    private async _errorWrap(fn : () => Promise<void>, platformData : PlatformData) : Promise<void> {
        try {
            try {
                await fn();
            } catch(e) {
                if (this._isUnsupportedError(e))
                    await this._doHandleCommand(new UserInput.Unsupported(platformData), null, [], true);
                else
                    throw e;
            }
        } catch(e) {
            if (e.code === 'EHOSTUNREACH' || e.code === 'ETIMEDOUT') {
                await this.sendReply('Sorry, I cannot contact the Almond service. Please check your Internet connection and try again later.', null);
            } else if (typeof e.code === 'number' && (e.code === 404 || e.code >= 500)) {
                await this.sendReply('Sorry, there seems to be a problem with the Almond service at the moment. Please try again later.', null);
            } else {
                await this.sendReply(interpolate(this._("Sorry, I had an error processing your command: ${error}"), {
                    error: e.message
                }, { locale: this.platform.locale, timezone: this.platform.timezone })||'', null);
                console.error(e);
            }
            await this._loop.reset();
            await this.sendAskSpecial();
        }
    }

    private _sendUtterance(utterance : string) {
        return this._nlu.sendUtterance(utterance, this._context.code, this._context.entities, {
            expect: this._expecting ? String(this._expecting) : undefined,
            choices: this._choices,
            store: this._prefs.get('sabrina-store-log') as string || 'no'
        });
    }

    private _resetInactivityTimeout() {
        // after "options.inactivityTimeout" milliseconds we inform the app that the conversation
        // is inactive (turn off LEDs, close the microphone, etc.)
        if (this._inactivityTimeout)
            clearTimeout(this._inactivityTimeout);
        if (this._inactivityTimeoutSec > 0) {
            this._inactivityTimeout = setTimeout(() => {
                this.emit('inactive');
            }, this._inactivityTimeoutSec);
        }

        // after "options.contextResetTimeout", we reset the context, forgetting the state of the
        // conversation
        if (this._contextResetTimeout)
            clearTimeout(this._contextResetTimeout);
        if (this._contextResetTimeoutSec) {
            this._contextResetTimeout = setTimeout(() => {
                this._loop.reset();
            }, this._contextResetTimeoutSec);
        }
    }

    async addOutput(out : ConversationDelegate, replayHistory = true) {
        this._delegates.add(out);
        if (replayHistory) {
            for (const msg of this._history)
                await out.addMessage(msg);
        }
    }
    async removeOutput(out : ConversationDelegate) {
        this._delegates.delete(out);
    }

    private async _addMessage(msg : Message) {
        msg.id = this._nextMsgId ++;
        this._history.push(msg);
        if (this._history.length > 30)
            this._history.shift();
        await Promise.all(Array.from(this._delegates).map((out) => out.addMessage(msg)));
    }

    async handleCommand(command : string, platformData : PlatformData = {},
                        postprocess ?: (analysis : ParserClient.PredictionResult) => void) : Promise<void> {
        this.stats.hit('sabrina-command');
        this.emit('active');
        this._resetInactivityTimeout();
        await this._addMessage({ type: MessageType.COMMAND, command });
        if (this._debug)
            console.log('Received assistant command ' + command);

        return this._errorWrap(async () => {
            if (this._raw && command !== null) {
                const intent = new UserInput.Answer(new ThingTalk.Ast.Value.String(command), platformData);
                return this._doHandleCommand(intent, null, [], true);
            }

            const analyzed = await this._sendUtterance(command);
            if (postprocess)
                postprocess(analyzed);
            return this._continueHandleCommand(command, analyzed, platformData);
        }, platformData);
    }

    async handleParsedCommand(root : any, title ?: string, platformData : PlatformData = {}) : Promise<void> {
        this.stats.hit('sabrina-parsed-command');
        this.emit('active');
        this._resetInactivityTimeout();
        if (typeof root === 'string')
            root = JSON.parse(root);
        await this._addMessage({ type: MessageType.COMMAND, command: title || '\\r ' + JSON.stringify(root), json: root });
        if (this._debug)
            console.log('Received pre-parsed assistant command');
        if (root.example_id) {
            this.thingpedia.clickExample(root.example_id).catch((e) => {
                console.error('Failed to record example click: ' + e.message);
            });
        }

        return this._errorWrap(async () => {
            const intent = await UserInput.parse(root, this.thingpedia, this.schemas,
                this._getContext(null, platformData));
            return this._doHandleCommand(intent, null, [], true);
        }, platformData);
    }

    async handleThingTalk(program : string, platformData : PlatformData = {}) : Promise<void> {
        this.stats.hit('sabrina-thingtalk-command');
        this.emit('active');
        this._resetInactivityTimeout();
        await this._addMessage({ type: MessageType.COMMAND, command: '\\t ' + program });
        if (this._debug)
            console.log('Received ThingTalk program');

        return this._errorWrap(async () => {
            const intent = await UserInput.parse({ program }, this.thingpedia, this.schemas, this._getContext(null, platformData));
            return this._doHandleCommand(intent, null, [], true);
        }, platformData);
    }

    async setHypothesis(hypothesis : string) : Promise<void> {
        await Promise.all(Array.from(this._delegates).map((out) => out.setHypothesis(hypothesis)));
    }

    async sendAskSpecial() : Promise<void> {
        const what = ValueCategory.toAskSpecial(this._expecting);

        if (this._debug) {
            if (what !== null && what !== 'generic')
                console.log('Genie sends a special request');
            else if (what !== null)
                console.log('Genie expects an answer');
        }

        await Promise.all(Array.from(this._delegates).map((out) => out.setExpected(what, this._context)));
    }

    sendReply(message : string, icon : string|null) {
        if (this._debug)
            console.log('Genie says: ' + message);
        return this._addMessage({ type: MessageType.TEXT, text: message, icon });
    }

    sendResult(message : ResultLike, icon : string|null) {
        return this._addMessage({ type: MessageType.RESULT, text: message.toLocaleString(this._locale), result: message, icon });
    }

    sendPicture(url : string, icon : string|null) {
        if (this._debug)
            console.log('Genie sends picture: '+ url);
        return this._addMessage({ type: MessageType.PICTURE, url, icon });
    }

    sendRDL(rdl : RDL, icon : string|null) {
        if (this._debug)
            console.log('Genie sends RDL: '+ rdl.callback);
        return this._addMessage({ type: MessageType.RDL, rdl, icon });
    }

    sendChoice(idx : number, title : string) {
        if (this._expecting !== ValueCategory.MultipleChoice)
            console.log('UNEXPECTED: sendChoice while not expecting a MultipleChoice');

        this._choices[idx] = title;
        if (this._debug)
            console.log('Genie sends multiple choice button: '+ title);
        return this._addMessage({ type: MessageType.CHOICE, idx, title });
    }

    async resendChoices() {
        if (this._expecting !== ValueCategory.MultipleChoice)
            console.log('UNEXPECTED: sendChoice while not expecting a MultipleChoice');

        for (let idx = 0; idx < this._choices.length; idx++)
            await this._addMessage({ type: MessageType.CHOICE, idx, title: this._choices[idx] });
    }

    sendButton(title : string, json : string) {
        if (this._debug)
            console.log('Genie sends generic button: '+ title);
        return this._addMessage({ type: MessageType.BUTTON, json, title });
    }

    sendLink(title : string, url : string) {
        if (this._debug)
            console.log('Almond sends link: '+ url);
        return this._addMessage({ type: MessageType.LINK, url, title });
    }
}
