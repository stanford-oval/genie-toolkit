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

    setHypothesis() {
        // ignore
    }

    setExpected(what : string|null) {
        assert(this._askSpecial === null);
        this._askSpecial = what;
    }

    async addMessage(message : Message) {
        this._buffer.push(message);
    }
}

type ConverseInput = ({
    type : 'command';
    text : string;
} | {
    type : 'parsed';
    json : any;
    title ?: string;
} | {
    type : 'tt';
    code : string;
}) & PlatformData;

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
    private _conversations : Map<string, Conversation>;
    private _lastConversation : Conversation|null;

    constructor(engine : Engine, nluModelUrl : string|undefined, notificationConfig : NotificationConfig) {
        super();

        this._engine = engine;
        this._notificationFormatter = new NotificationFormatter(engine);
        this._nluModelUrl = nluModelUrl;
        this._notificationOutputs = new Set;
        this._conversations = new Map;
        this._lastConversation = null;

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
    async converse(command : {
        type : 'command';
        text : string;
    } & PlatformData, conversationId : string) : Promise<{
        conversationId : string;
        messages : Message[],
        askSpecial : string|null;
    }>;
    async converse(command : {
        type : 'parsed';
        json : any;
        title ?: string;
    } & PlatformData, conversationId : string) : Promise<{
        conversationId : string;
        messages : Message[],
        askSpecial : string|null;
    }>;
    async converse(command : {
        type : 'tt';
        code : string;
    } & PlatformData, conversationId : string) : Promise<{
        conversationId : string;
        messages : Message[],
        askSpecial : string|null;
    }>;
    async converse(command : ConverseInput, conversationId : string) {
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
        let notificationConfigs = app.notifications;
        if (notificationConfigs.length === 0) {
            const prefs = this._engine.platform.getSharedPreferences();
            const defaultBackend = (prefs.get('notification-backend') as string || 'conversation');
            notificationConfigs = [{ backend: defaultBackend, config: {} }];
        }

        let hasConversation = false;
        let hasNonConversation = false;
        for (const config of notificationConfigs) {
            if (config.backend === 'conversation')
                hasConversation = true;
            else
                hasNonConversation = true;
        }

        const promises = [];
        if (this._notificationOutputs.size > 0 || hasNonConversation) {
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

            for (const config of notificationConfigs) {
                if (hasConversation && config.backend === 'conversation')
                    continue;

                if (config.backend.startsWith('thingpedia/')) {
                    const deviceId = config.backend.substring('thingpedia/'.length);
                    const backend = this._dynamicNotificationBackends.getById(deviceId);
                    if (backend)
                        promises.push(backend.notify(notification));
                } else {
                    const backend = this._staticNotificationBackends[config.backend];
                    if (backend)
                        promises.push(backend.notify(notification, config.config));
                }
            }
        }

        if (hasConversation) {
            for (const conv of this._conversations.values())
                promises.push(conv.notify(app, outputType, outputValue));
        }
        await Promise.all(promises);
    }

    async notifyError(app : AppExecutor, error : Error) {
        const promises = [];
        const notification = {
            appId: app.uniqueId,
            icon: app.icon,
            error: error
        };
        for (const out of this._notificationOutputs.values())
            promises.push(out.notifyError(notification));

        let notificationConfigs = app.notifications;
        if (notificationConfigs.length === 0) {
            const prefs = this._engine.platform.getSharedPreferences();
            const defaultBackend = (prefs.get('notification-backend') as string || 'conversation');
            notificationConfigs = [{ backend: defaultBackend, config: {} }];
        }

        for (const config of notificationConfigs) {
            if (config.backend === 'conversation') {
                for (const conv of this._conversations.values())
                    promises.push(conv.notifyError(app, error));
            } else if (config.backend.startsWith('thingpedia/')) {
                const deviceId = config.backend.substring('thingpedia/'.length);
                const backend = this._dynamicNotificationBackends.getById(deviceId);
                if (backend)
                    promises.push(backend.notifyError(notification));
            } else {
                const backend = this._staticNotificationBackends[config.backend];
                if (backend)
                    promises.push(backend.notifyError(notification, config.config));
            }
        }

        await Promise.all(promises);
    }

    getConversation(id : string) : Conversation|undefined {
        return this._conversations.get(id);
    }

    get lastConversation() {
        return this._lastConversation;
    }

    async getOrOpenConversation(id : string, options : ConversationOptions, state ?: ConversationState) {
        if (this._conversations.has(id))
            return this._conversations.get(id)!;
        options = options || {};
        if (!options.nluServerUrl)
            options.nluServerUrl = this._nluModelUrl;
        const conv = this.openConversation(id, options);
        await conv.start(state);
        return conv;
    }

    openConversation(id : string, options : ConversationOptions) {
        this._conversations.delete(id);
        options = options || {};
        if (!options.nluServerUrl)
            options.nluServerUrl = this._nluModelUrl;

        let deleteWhenInactive = options.deleteWhenInactive;
        if (deleteWhenInactive === undefined)
            deleteWhenInactive = true;
        const conv = new Conversation(this._engine, id, options);
        conv.on('active', () => {
            this._lastConversation = conv;
        });
        if (deleteWhenInactive) {
            conv.on('inactive', () => {
                if (this._conversations.get(conv.id) === conv)
                    this._conversations.delete(conv.id);
            });
        }
        this._lastConversation = conv;
        this._conversations.set(id, conv);
        return conv;
    }

    closeConversation(id : string) {
        this._conversations.delete(id);
    }
}
