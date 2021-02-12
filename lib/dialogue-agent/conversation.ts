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


import path from "path";
import fs from "fs";
import * as events from 'events';
import type * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';

import * as I18n from '../i18n';

import { PlatformData } from './user-input';
import ValueCategory from './value-category';
import DialogueLoop from './dialogue-loop';
import { MessageType, Message, RDL } from './protocol';
import { EntityMap } from '../utils/entity-utils';
import * as ThingTalkUtils from '../utils/thingtalk';
import type Engine from '../engine';
import * as StreamUtils from "../utils/stream-utils";
import { DialogueSerializer, DialogueTurn } from "../dataset-tools/parsers";

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
    log ?: boolean;
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

interface ResultLike {
    toLocaleString(locale ?: string) : string;
}

export class DialogueTurnLog {
    private readonly _turn : DialogueTurn;
    private _done : boolean;

    constructor() {
        this._turn = {
            context: null,
            agent: null,
            agent_target: null,
            intermediate_context: null,
            user: '',
            user_target: ''
        };
        this._done = false;
    }

    get turn() {
        return this._turn;
    }

    get done() {
        return this._done;
    }

    finish() {
        this._done = true;
    }

    update(field : keyof DialogueTurn, value : string) {
        this._turn[field] = this._turn[field] ? this._turn[field] + '\n' + value : value;
    }
}

class DialogueLog {
    private readonly _turns : DialogueTurnLog[];
    private _done : boolean;

    constructor() {
        this._turns = [];
        this._done = false;
    }

    get turns() {
        return this._turns;
    }

    get done() {
        return this._done;
    }

    finish() {
        this._done = true;
        if (this.turns.length) {
            const lastTurn = this.turns[this.turns.length - 1];
            lastTurn.finish();
        }
    }

    append(turn : DialogueTurnLog) {
        this._turns.push(turn);
    }
}

/**
 * A single session of conversation in Almond.
 *
 * This object is responsible for maintaining the history of the conversation
 * to support clients reconnecting to the same conversation later, as well
 * as tracking connected clients and inactivity timeouts.
 *
 * The actual conversation logic is in {@link DialogueLoop}.
 */
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

    private _loop : DialogueLoop;
    private _expecting : ValueCategory|null;
    private _context : Context;

    private _delegates : Set<ConversationDelegate>;
    private _history : Message[];
    private _nextMsgId : number;
    private _inactivityTimeout : NodeJS.Timeout|null;
    private _inactivityTimeoutSec : number;
    private _contextResetTimeout : NodeJS.Timeout|null;
    private _contextResetTimeoutSec : number;

    private _log : DialogueLog[];

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

        this._options = options;
        this._debug = !!this._options.debug;

        this.rng = options.rng || Math.random;

        this._loop = new DialogueLoop(this, this._engine, {
            nluServerUrl: options.nluServerUrl,
            nlgServerUrl: options.nlgServerUrl,
            debug: this._debug
        });
        this._expecting = null;
        this._context = { code: ['null'], entities: {} };
        this._delegates = new Set;
        this._history = [];
        this._nextMsgId = 0;

        this._inactivityTimeout = null;
        this._inactivityTimeoutSec = options.inactivityTimeout || DEFAULT_CONVERSATION_TTL;
        this._contextResetTimeout = null;
        this._contextResetTimeoutSec = options.contextResetTimeout || this._inactivityTimeoutSec;

        this._log = [];
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

    get inRecordingMode() : boolean {
        return !!this._options.log;
    }

    startRecording() {
        this._options.log = true;
    }

    endRecording() {
        this._options.log = false;
    }

    notify(appId : string, icon : string|null, outputType : string, outputValue : Record<string, unknown>) {
        return this._loop.dispatchNotify(appId, icon, outputType, outputValue);
    }

    notifyError(appId : string, icon : string|null, error : Error) {
        return this._loop.dispatchNotifyError(appId, icon, error);
    }

    setExpected(expecting : ValueCategory|null, context : Context) : void {
        this._expecting = expecting;
        this._context = context;
    }

    async start() : Promise<void> {
        this._resetInactivityTimeout();
        return this._loop.start(!!this._options.showWelcome);
    }

    async stop() : Promise<void> {
        return this._loop.stop();
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

    async handleCommand(command : string, platformData : PlatformData = {}) : Promise<void> {
        this.stats.hit('sabrina-command');
        this.emit('active');
        this._resetInactivityTimeout();
        await this._addMessage({ type: MessageType.COMMAND, command });
        if (this._debug)
            console.log('Received assistant command ' + command);

        return this._loop.handleCommand({ type: 'command', utterance: command, platformData });
    }

    async handleParsedCommand(root : any, title ?: string, platformData : PlatformData = {}) : Promise<void> {
        const command = `\\r ${typeof root === 'string' ? root : JSON.stringify(root)}`;
        this.stats.hit('sabrina-parsed-command');
        this.emit('active');
        this._resetInactivityTimeout();
        if (typeof root === 'string')
            root = JSON.parse(root);
        await this._addMessage({ type: MessageType.COMMAND, command: title || command, json: root });

        if (this._debug)
            console.log('Received pre-parsed assistant command');
        if (root.example_id) {
            this.thingpedia.clickExample(root.example_id).catch((e) => {
                console.error('Failed to record example click: ' + e.message);
            });
        }

        if ('program' in root)
            return this.handleThingTalk(root.program, platformData);

        const { code, entities } = root;
        for (const name in entities) {
            if (name.startsWith('SLOT_')) {
                const slotname = root.slots![parseInt(name.substring('SLOT_'.length))];
                const slotType = ThingTalk.Type.fromString(root.slotTypes![slotname]);
                const value = ThingTalk.Ast.Value.fromJSON(slotType, entities[name]);
                entities[name] = value;
            }
        }

        const parsed = await ThingTalkUtils.parsePrediction(code, entities, {
            thingpediaClient: this._engine.thingpedia,
            schemaRetriever: this._engine.schemas,
            loadMetadata: true
        }, true);
        return this._loop.handleCommand({ type: 'thingtalk', parsed, platformData });
    }

    async handleThingTalk(program : string, platformData : PlatformData = {}) : Promise<void> {
        const command = `\\t ${program}`;
        this.stats.hit('sabrina-thingtalk-command');
        this.emit('active');
        this._resetInactivityTimeout();
        await this._addMessage({ type: MessageType.COMMAND, command });
        if (this._debug)
            console.log('Received ThingTalk program');

        const parsed = await ThingTalkUtils.parse(program, {
            thingpediaClient: this._engine.thingpedia,
            schemaRetriever: this._engine.schemas,
            loadMetadata: true
        });
        return this._loop.handleCommand({ type: 'thingtalk', parsed, platformData });
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
        if (this._debug)
            console.log('Genie sends multiple choice button: '+ title);
        return this._addMessage({ type: MessageType.CHOICE, idx, title });
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

    private get _lastDialogue() {
        if (this._log.length === 0)
            return null;
        return this._log[this._log.length - 1];
    }

    private get _lastTurn() {
        const lastDialogue = this._lastDialogue;
        if (!lastDialogue || lastDialogue.turns.length === 0)
            return null;
        return lastDialogue.turns[lastDialogue.turns.length - 1];
    }

    appendNewDialogue() {
        this._log.push(new DialogueLog());
    }

    dialogueFinished() {
        const last = this._lastDialogue;
        if (last)
            last.finish();
    }

    turnFinished() {
        const last = this._lastTurn;
        if (last)
            last.finish();
    }

    appendNewTurn(turn : DialogueTurnLog) {
        const last = this._lastDialogue;
        if (!last || last.done)
            this.appendNewDialogue();
        const dialogue = this._lastDialogue!;
        dialogue.append(turn);
    }

    voteLast(vote : 'up'|'down') {
        const last = this._lastTurn;
        if (!last)
            throw new Error('No dialogue is logged');
        last.turn.vote = vote;
    }

    commentLast(comment : string) {
        const last = this._lastTurn;
        if (!last)
            throw new Error('No dialogue is logged');
        last.turn.comment = comment;
    }

    updateLog(field : keyof DialogueTurn, value : string) {
        let last = this._lastTurn;
        if (!last || last.done) {
            last = new DialogueTurnLog();
            this.appendNewTurn(last);
        }
        last.update(field, value);
    }

    async saveLog() {
        const dir = path.join(this._engine.platform.getWritableDir(), 'logs');
        try {
            fs.mkdirSync(dir);
        } catch(e) {
            if (e.code !== 'EEXIST')
                throw e;
        }
        const logfile = path.join(dir, this.id + '.txt');
        const serializer = new DialogueSerializer({ annotations: true });

        const output = fs.createWriteStream(logfile);

        serializer.pipe(output);
        for (const dialogue of this._log)
            serializer.write({ id: this.id, turns: dialogue.turns.map((log) => log.turn) });
        serializer.end();

        await StreamUtils.waitFinish(output);
    }

    get log() : string|null {
        const log = path.join(this._engine.platform.getWritableDir(), 'logs', this.id + '.txt');
        if (!fs.existsSync(log))
            return null;
        return log;
    }
}
