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

import * as Tp from 'thingpedia';
import * as events from 'events';

import Conversation, {
    ConversationDelegate,
    ConversationOptions,
    ConversationState
} from './conversation';
import { PlatformData, Message } from './protocol';
import NotificationFormatter from './notifications/formatter';
import {
    StaticNotificationBackends,
    ThingpediaNotificationBackend,
    NotificationConfig,
    NotificationDelegate,
} from './notifications';

import AppExecutor from '../engine/apps/app_executor';
import type Engine from '../engine';
import DeviceView from '../engine/devices/device_view';
import DeviceInterfaceMapper from '../engine/devices/device_interface_mapper';
import { ConversationStateRow, LocalTable } from "../engine/db";
import TimedReference from '../utils/timed_ref';

/**
 * Maximum time that a conversation is kept in memory.
 *
 * After this time, the conversation is released and must be restored from disk.
 */
const CONVERSATION_TTL = 120000;

/**
 * A conversation delegate that buffers all commands until the dialogue turn
 * is complete.
 */
class StatelessConversationDelegate implements ConversationDelegate {
    private _buffer : Message[];
    private _askSpecial : string|null;
    private _id : string;

    constructor(conversationId : string) {
        this._buffer = [];
        this._askSpecial = null;
        this._id = conversationId;
    }

    destroy() {
    }

    flush() {
        const buffer = this._buffer;
        const askSpecial = this._askSpecial;
        this._buffer = [];
        this._askSpecial = null;
        return {
            conversationId : this._id,
            messages: buffer,
            askSpecial: askSpecial,
        };
    }

    async setHypothesis() {
        // ignore
    }
    async addDevice() {
        // ignore
    }

    async setExpected(what : string|null) {
        this._askSpecial = what;
    }

    async addMessage(message : Message) {
        this._buffer.push(message);
    }
}

export interface CommandInput {
    type : 'command';
    text : string;
}

export interface ParsedInput {
    type : 'parsed';
    json : any;
    title ?: string;
}

export interface ThingTalkInput {
    type : 'tt';
    code : string;
}

export type ConverseInput = (CommandInput | ParsedInput | ThingTalkInput) & PlatformData;

/**
 * The main controller class for interaction with the user.
 *
 * This class manages multiple conversations (independent sessions of the
 * agent with their own state), it dispatches notifications, and it
 * handles connections from API clients.
 */
export default class AssistantDispatcher extends events.EventEmitter {
    private _engine : Engine;
    private _notificationFormatter : NotificationFormatter;
    private _nluModelUrl : string|undefined;

    private _notificationOutputs : Set<NotificationDelegate>;
    private _staticNotificationBackends : Record<string, Tp.Capabilities.NotificationBackend>;
    private _dynamicNotificationBackends : DeviceInterfaceMapper<Tp.Capabilities.NotificationBackend>;
    private _conversations : Map<string, TimedReference<Conversation>>;
    private _conversationStateDB : LocalTable<ConversationStateRow>;

    constructor(engine : Engine, nluModelUrl : string|undefined, notificationConfig : NotificationConfig) {
        super();

        this._engine = engine;
        this._notificationFormatter = new NotificationFormatter(engine);
        this._nluModelUrl = nluModelUrl;
        this._notificationOutputs = new Set;
        this._conversations = new Map;
        this._conversationStateDB = this._engine.db.getLocalTable('conversation_state');

        this._dynamicNotificationBackends = new DeviceInterfaceMapper(
            new DeviceView(engine.devices, 'org.thingpedia.notification-provider', {}),
            (device) => new ThingpediaNotificationBackend(device));

        // initialize static notification backends
        this._staticNotificationBackends = {};
        for (const key in notificationConfig) {
            const key2 = key as keyof typeof StaticNotificationBackends;
            this._staticNotificationBackends[key] = new (StaticNotificationBackends[key2])(engine, notificationConfig[key2] as any);
        }
    }

    async start() {
        await this._notificationFormatter.initialize();
        this._dynamicNotificationBackends.start();
    }
    async stop() {
        this._dynamicNotificationBackends.stop();
    }

    /**
     * Dispatch one single command to an existing conversation.
     *
     * This is an alternative to getting the conversation and adding a
     * ConversationDelegate to it.
     * It exists for the convenience of REST API clients which do not keep
     * an open web socket.
     */
    async converse(command : ConverseInput, conversationId : string) : Promise<{
        conversationId : string;
        messages : Message[],
        askSpecial : string|null;
    }> {
        const conversation = await this.getOrOpenConversation(conversationId, {
            showWelcome: false,
            anonymous: false,
            debug: true
        });
        const delegate = new StatelessConversationDelegate(conversationId);
        await conversation.addOutput(delegate, false);

        switch (command.type) {
        case 'command':
            await conversation.handleCommand(command.text, command);
            break;
        case 'parsed':
            await conversation.handleParsedCommand(command.json, command.title, command);
            break;
        case 'tt':
            await conversation.handleThingTalk(command.code, command);
            break;
        }

        await conversation.removeOutput(delegate);
        const result = delegate.flush();
        return result;
    }

    /**
     * Add an API client that wishes to listen for notifications.
     *
     * The delegate methods will be invoked for every notification
     * and asynchronous error emitted by the engine.
     */
    addNotificationOutput(output : NotificationDelegate) {
        this._notificationOutputs.add(output);
    }
    /**
     * Remove a previously registered notification API client.
     */
    removeNotificationOutput(output : NotificationDelegate) {
        this._notificationOutputs.delete(output);
    }

    /**
     * Get the list of notification backends that can be used.
     */
    getAvailableNotificationBackends() : Tp.Capabilities.NotificationBackend[] {
        return Object.values(this._staticNotificationBackends)
            .concat(Array.from(this._dynamicNotificationBackends.values()));
    }

    /**
     * Dispatch a notification (a single new result from a stream) from a
     * ThingTalk program.
     *
     * @param app - the running ThingTalk program that generated the notification
     * @param outputType - a string identifying the type of result to display
     * @param outputValue - the new value to display
     */
    async notify(app : AppExecutor, outputType : string, outputValue : Record<string, unknown>) {
        const prefs = this._engine.platform.getSharedPreferences();
        const notificationBackend =
            app.notifications ? app.notifications.backend : (prefs.get('notification-backend') as string || 'conversation');

        const promises = [];
        if (this._notificationOutputs.size > 0 || notificationBackend !== 'conversation') {
            const messages = await this._notificationFormatter.formatNotification(app.name, app.program, outputType, outputValue);

            const notification = {
                appId: app.uniqueId,
                icon: app.icon,
                raw: outputValue,
                type: outputType,
                formatted: messages
            };
            for (const out of this._notificationOutputs.values())
                promises.push(out.notify(notification));

            if (notificationBackend !== 'conversation') {
                if (notificationBackend.startsWith('thingpedia/')) {
                    const deviceId = notificationBackend.substring('thingpedia/'.length);
                    const backend = this._dynamicNotificationBackends.getById(deviceId);
                    if (backend)
                        promises.push(backend.notify(notification));
                } else {
                    const backend = this._staticNotificationBackends[notificationBackend];
                    if (backend)
                        promises.push(backend.notify(notification, app.notifications?.config));
                }
            }
        }

        if (notificationBackend === 'conversation') {
            for (const conv of this._conversations.values()) {
                promises.push(conv.acquire(false).then(async (conv) => {
                    if (conv)
                        await conv.notify(app, outputType, outputValue);
                }));
            }
        }
        await Promise.all(promises);
    }

    async notifyError(app : AppExecutor, error : Error) {
        const prefs = this._engine.platform.getSharedPreferences();
        const notificationBackend =
            app.notifications ? app.notifications.backend : (prefs.get('notification-backend') as string || 'conversation');

        const promises = [];
        const notification = {
            appId: app.uniqueId,
            icon: app.icon,
            error: error
        };
        for (const out of this._notificationOutputs.values())
            promises.push(out.notifyError(notification));

        if (notificationBackend === 'conversation') {
            for (const conv of this._conversations.values()) {
                promises.push(conv.acquire(false).then(async (conv) => {
                    if (conv)
                        await conv.notifyError(app, error);
                }));
            }
        } else if (notificationBackend.startsWith('thingpedia/')) {
            const deviceId = notificationBackend.substring('thingpedia/'.length);
            const backend = this._dynamicNotificationBackends.getById(deviceId);
            if (backend)
                promises.push(backend.notifyError(notification));
        } else {
            const backend = this._staticNotificationBackends[notificationBackend];
            if (backend)
                promises.push(backend.notifyError(notification, app.notifications?.config));
        }

        await Promise.all(promises);
    }

    private _getConversationRef(id : string) {
        const existing = this._conversations.get(id);
        if (existing)
            return existing;
        const ref = new TimedReference<Conversation>(CONVERSATION_TTL, async (conv) => {
            if (this._conversations.get(id) === ref)
                this._conversations.delete(id);
            await conv.stop();
        });
        this._conversations.set(id, ref);
        return ref;
    }

    private async getConversationState(conversationId : string) : Promise<ConversationState|undefined> {
        const state = await this._conversationStateDB.getOne(conversationId).then((row) => {
            if (row) {
                return {
                    dialogueState: row.dialogueState ? JSON.parse(row.dialogueState) : null,
                    lastMessageId: row.lastMessageId || 0,
                    recording: row.recording || false,
                };
            }
            return undefined;
        });
        return state;
    }

    async getOrOpenConversation(id : string, options : ConversationOptions, state ?: ConversationState) {
        options = options || {};
        if (!options.nluServerUrl)
            options.nluServerUrl = this._nluModelUrl;
        const ref = this._getConversationRef(id);
        return ref.acquire(true, async () => {
            const conv = new Conversation(this._engine, id, options);
            const convState = state ? state : await this.getConversationState(id);
            await conv.start(convState);
            return conv;
        });
    }

    protected openConversation(id : string, options : ConversationOptions) {
        options = options || {};
        if (!options.nluServerUrl)
            options.nluServerUrl = this._nluModelUrl;

        const ref = this._getConversationRef(id);
        ref.releaseNow();
        return ref.acquire(true, async () => {
            return new Conversation(this._engine, id, options);
        });
    }

    closeConversation(id : string) {
        this._getConversationRef(id).release();
    }
}
