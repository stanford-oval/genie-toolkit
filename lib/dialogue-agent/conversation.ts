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
import * as ThingTalk from 'thingtalk';
import * as Stream from "stream";

import * as I18n from '../i18n';

import ValueCategory from './value-category';
import { DialogueLoop } from './dialogue-loop';
import { PlatformData, MessageType, Message, RDL } from './protocol';
import { EntityMap } from '../utils/entity-utils';
import * as ThingTalkUtils from '../utils/thingtalk';
import type Engine from '../engine';
import { DialogueSerializer, DialogueTurn } from "../dataset-tools/parsers";
import AppExecutor from '../engine/apps/app_executor';
import ConversationLogger from './logging';
import { ConversationStateRow, LocalTable } from "../engine/db";
import ConversationHistory from './conversation_history';

const DummyStatistics = {
    hit() {
    }
};

const DEFAULT_CONVERSATION_TTL = 600000; // 10 minutes

export interface ConversationOptions {
    nluServerUrl ?: string;
    nlgServerUrl ?: string;
    anonymous ?: boolean;
    debug ?: boolean;
    rng ?: () => number;
    contextResetTimeout ?: number;
    showWelcome ?: boolean;
    log ?: boolean;
    dialogueFlags ?: Record<string, boolean>;
    useConfidence ?: boolean;
    faqModels ?: Record<string, {
        url : string;
        highConfidence ?: number;
        lowConfidence ?: number;
    }>;
}

interface Statistics {
    hit(key : string) : void;
}

export interface ConversationDelegate {
    setHypothesis(hyp : string) : Promise<void>;
    setExpected(expect : string|null, ctx : {
        code : string[];
        entities : EntityMap;
    }) : Promise<void>;
    addMessage(msg : Message) : Promise<void>;
    destroy() : void;
}

export interface ConversationState {
    dialogueState : Record<string, unknown>;
    lastMessageId : number;
    recording : boolean;
}

/**
 * A single session of conversation in Genie.
 *
 * This object is responsible for maintaining the history of the conversation
 * to support clients reconnecting to the same conversation later, as well
 * as tracking connected clients and inactivity timeouts.
 */
export default class Conversation extends events.EventEmitter {
    // NOTE: The actual conversation logic is in DialogueLoop.
    private _engine : Engine;
    private _conversationId : string;
    private _locale : string;
    _ : (x : string) => string;

    private _stats : Statistics;
    private _options : Readonly<ConversationOptions>;
    private _debug : boolean;
    private _dialogueFlags : Record<string, boolean>;
    rng : () => number;

    private _loop : DialogueLoop;
    private _expecting : ValueCategory|null;
    private _context : {
        code : string[];
        entities : EntityMap;
    };

    private _started : boolean;
    private _delegates : Set<ConversationDelegate>;
    private _history : ConversationHistory;
    private _lastMessageId : number;
    private _contextResetTimeout : NodeJS.Timeout|null;
    private _contextResetTimeoutSec : number;
    private _recording : boolean;

    private _log : ConversationLogger;
    private readonly _conversationStateDB : LocalTable<ConversationStateRow>;

    constructor(engine : Engine,
                conversationId : string,
                options : ConversationOptions = {}) {
        super();
        this._engine = engine;
        this._conversationStateDB = this._engine.db.getLocalTable('conversation_state');

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
        this._dialogueFlags = options.dialogueFlags || {};
        this._recording = options.log ?? false;

        this.rng = options.rng || Math.random;

        this._loop = new DialogueLoop(this, this._engine, {
            nluServerUrl: options.nluServerUrl,
            nlgServerUrl: options.nlgServerUrl,
            faqModels: options.faqModels || {},
            useConfidence: options.useConfidence ?? true,
            debug: this._debug,
            rng: this.rng,
        });
        this._expecting = null;
        this._context = { code: ['null'], entities: {} };
        this._delegates = new Set;
        this._history = new ConversationHistory(engine, conversationId);
        this._lastMessageId = -1;
        this._started = false;

        this._contextResetTimeout = null;
        this._contextResetTimeoutSec = options.contextResetTimeout || DEFAULT_CONVERSATION_TTL;

        this._log = new ConversationLogger(engine.db.getLocalTable('conversation'), this._conversationId);
    }

    get isAnonymous() : boolean {
        return !!this._options.anonymous;
    }

    get id() : string {
        return this._conversationId;
    }

    get engine() : Engine {
        return this._engine;
    }

    get stats() : Statistics {
        return this._stats;
    }

    get inRecordingMode() : boolean {
        return this._recording;
    }

    get dialogueFlags() : Record<string, boolean> {
        return this._dialogueFlags;
    }

    async startRecording() {
        this._recording = true;
        await this._saveState();
    }

    async endRecording() {
        await this._log.dialogueFinished();
        this._recording = false;
        await this._saveState();
    }

    notify(app : AppExecutor, outputType : string, outputValue : Record<string, unknown>) {
        return this._loop.dispatchNotify(app, outputType, outputValue);
    }

    notifyError(app : AppExecutor, error : Error) {
        return this._loop.dispatchNotifyError(app, error);
    }

    setExpected(expecting : ValueCategory|null, context : {
        code : string[];
        entities : EntityMap;
    }) : void {
        this._expecting = expecting;
        this._context = context;
    }

    async start(state ?: ConversationState) : Promise<void> {
        await this._history.init();
        this._resetInactivityTimeout();

        if (state) {
            this._lastMessageId = state.lastMessageId;
            this._recording = state.recording;
        }
        this._started = true;

        return this._loop.start(!!this._options.showWelcome,
            state ? state.dialogueState : null);
    }

    async stop() : Promise<void> {
        return this._loop.stop();
    }

    private _resetInactivityTimeout() {
        // after "options.contextResetTimeout", we reset the context, forgetting the state of the
        // conversation
        if (this._contextResetTimeout)
            clearTimeout(this._contextResetTimeout);
        if (this._contextResetTimeoutSec > 0) {
            this._contextResetTimeout = setTimeout(() => {
                this._loop.reset();
            }, this._contextResetTimeoutSec);
        }
    }

    async addOutput(out : ConversationDelegate, replayHistory = true) {
        this._delegates.add(out);
        if (replayHistory) {
            for (const msg of this._history.getCached()) {
                if (!await this._callDelegate(out, (out) => out.addMessage(msg)))
                    return;
            }
        }

        if (this._started) {
            const what = ValueCategory.toString(this._expecting);
            await this._callDelegate(out, (out) => out.setExpected(what, this._context));
        }
    }
    removeOutput(out : ConversationDelegate) {
        this._delegates.delete(out);
    }

    private async _callDelegate(out : ConversationDelegate, fn : (out : ConversationDelegate) => unknown) {
        try {
            await fn(out);
            return true;
        } catch(e) {
            // delegate disappeared (likely a disconnected websocket)
            out.destroy();
            return false;
        }
    }

    private _callDelegates(fn : (out : ConversationDelegate) => unknown) {
        return Promise.all(Array.from(this._delegates).map((out) => this._callDelegate(out, fn)));
    }

    async setHypothesis(hypothesis : string) : Promise<void> {
        await this._callDelegates((out) => out.setHypothesis(hypothesis));
    }

    async sendAskSpecial() : Promise<void> {
        const what = ValueCategory.toString(this._expecting);

        if (this._debug) {
            if (what !== null && what !== 'generic')
                console.log('Genie sends a special request');
            else if (what !== null)
                console.log('Genie expects an answer');
        }

        await this._callDelegates((out) => out.setExpected(what, this._context));
    }

    /**
     * Add a message to the conversation history.
     *
     * This method is exported to inject conversation history from outside.
     */
    async addMessage(msg : Message) {
        if (msg.id !== undefined)
            this._lastMessageId = Math.max(this._lastMessageId, msg.id);
        else
            msg.id = (this._lastMessageId ++) + 1;
        await this._history.addMessage(msg);
        await this._callDelegates((out) => out.addMessage(msg));

        await this._saveState();
    }

    private async _saveState() {
        const serializedDialogueState = JSON.stringify(this._loop.getState());
        console.log(`Saving conversation state for ${this._conversationId} (${serializedDialogueState.length} characters)`);
        await this._conversationStateDB.insertOne(this._conversationId, {
            dialogueState: serializedDialogueState,
            lastMessageId: this._lastMessageId,
            recording: this._recording,
        });
    }

    /**
     * Extract the state from the conversation.
     *
     * This method is provided to save and restore the conversation state,
     * and transfer the conversation state between engines.
     */
    getState() : ConversationState {
        return {
            dialogueState: this._loop.getState(),
            lastMessageId: this._lastMessageId,
            recording: this._recording,
        };
    }

    async handleCommand(command : string, platformData : PlatformData = {}) : Promise<void> {
        this._engine.updateActivity();
        // if the command is just whitespace, ignore it without even adding it to the history
        if (!command.trim())
            return;

        this.stats.hit('sabrina-command');
        this.emit('active');
        this._resetInactivityTimeout();
        await this.addMessage({ type: MessageType.COMMAND, command });
        if (this._debug)
            console.log('Received assistant command ' + command);

        await this._loop.handleCommand({ type: 'command', utterance: command, platformData });
    }

    async handleParsedCommand(root : any, title ?: string, platformData : PlatformData = {}) : Promise<void> {
        this._engine.updateActivity();
        const command = `\\r ${typeof root === 'string' ? root : JSON.stringify(root)}`;
        this.stats.hit('sabrina-parsed-command');
        this.emit('active');
        this._resetInactivityTimeout();
        if (typeof root === 'string')
            root = JSON.parse(root);
        await this.addMessage({ type: MessageType.COMMAND, command: title || command, json: root });

        if (this._debug)
            console.log('Received pre-parsed assistant command');
        if (root.example_id) {
            this._engine.thingpedia.clickExample(root.example_id).catch((e) => {
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
            timezone: this._engine.platform.timezone,
            thingpediaClient: this._engine.thingpedia,
            schemaRetriever: this._engine.schemas,
            loadMetadata: true
        }, true);
        return this._loop.handleCommand({ type: 'thingtalk', parsed, platformData });
    }

    async handleThingTalk(program : string, platformData : PlatformData = {}) : Promise<void> {
        this._engine.updateActivity();
        const command = `\\t ${program}`;
        this.stats.hit('sabrina-thingtalk-command');
        this.emit('active');
        this._resetInactivityTimeout();
        await this.addMessage({ type: MessageType.COMMAND, command });
        if (this._debug)
            console.log('Received ThingTalk program');

        const parsed = await ThingTalkUtils.parse(program, {
            timezone: this._engine.platform.timezone,
            thingpediaClient: this._engine.thingpedia,
            schemaRetriever: this._engine.schemas,
            loadMetadata: true
        });
        return this._loop.handleCommand({ type: 'thingtalk', parsed, platformData });
    }

    sendReply(message : string, icon : string|null) {
        if (this._debug)
            console.log('Genie says: ' + message);
        return this.addMessage({ type: MessageType.TEXT, text: message, icon });
    }

    sendMedia(mediaType : 'picture'|'audio'|'video', url : string, alt : string|undefined, icon : string|null) {
        if (this._debug)
            console.log('Genie sends ' + mediaType + ': '+ url);
        return this.addMessage({ type: mediaType as MessageType.AUDIO|MessageType.VIDEO|MessageType.PICTURE, url, alt, icon });
    }

    sendRDL(rdl : RDL, icon : string|null) {
        if (this._debug)
            console.log('Genie sends RDL: '+ rdl.callback);
        return this.addMessage({ type: MessageType.RDL, rdl, icon });
    }

    sendSoundEffect(name : string, exclusive = false, icon : string|null) {
        if (this._debug)
            console.log('Genie sends sound effect: '+ name);
        return this.addMessage({ type: MessageType.SOUND_EFFECT, name, exclusive, icon });
    }

    sendChoice(idx : number, title : string) {
        if (this._expecting !== ValueCategory.MultipleChoice)
            console.log('UNEXPECTED: sendChoice while not expecting a MultipleChoice');
        if (this._debug)
            console.log('Genie sends multiple choice button: '+ title);
        return this.addMessage({ type: MessageType.CHOICE, idx, title });
    }

    sendButton(title : string, json : string) {
        if (this._debug)
            console.log('Genie sends generic button: '+ title);
        return this.addMessage({ type: MessageType.BUTTON, json, title });
    }

    sendLink(title : string, url : string, state : ConversationState) {
        if (this._debug)
            console.log('Genie sends link: '+ url);
        return this.addMessage({ type: MessageType.LINK, url, title, state });
    }

    sendNewProgram(program : {
        uniqueId : string;
        name : string;
        code : string;
        results : Array<Record<string, unknown>>;
        errors : string[];
        icon : string|null;
    }) {
        if (this._debug)
            console.log('Genie executed new program: '+ program.uniqueId);
        return this.addMessage({ type: MessageType.NEW_PROGRAM, ...program });
    }

    async dialogueFinished() {
        if (!this.inRecordingMode)
            return;
        await this._log.dialogueFinished();
    }

    async turnFinished() {
        if (!this.inRecordingMode)
            return;
        await this._log.turnFinished();
    }

    async voteLast(vote : 'up'|'down') {
        if (!this.inRecordingMode)
            return;
        await this._log.voteLast(vote);
    }

    async commentLast(comment : string) {
        if (!this.inRecordingMode)
            return;
        await this._log.commentLast(comment);
    }

    updateLog(field : Exclude<keyof DialogueTurn,'agent_timestamp'|'user_timestamp'>, value : string) {
        if (!this.inRecordingMode)
            return;
        this._log.updateLog(field, value);
    }

    readLog() {
        const readable = Stream.Readable.from(this._log.read());
        const serializer = new DialogueSerializer({ annotations: true });
        return readable.pipe(serializer);
    }
}
