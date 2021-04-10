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
import * as events from 'events';
import * as Tp from 'thingpedia';

import Conversation, {
    AssistantUser,
    ConversationDelegate,
    ConversationOptions
} from './conversation';
import { Message } from './protocol';
import NotificationFormatter, { FormattedObject } from './notifications/formatter';
import TwilioNotificationBackend from './notifications/twilio';

import type Engine from '../engine';
import DeviceView from '../engine/devices/device_view';

interface NotificationDelegate {
    notify(data : {
        appId : string;
        icon : string|null;
        raw : Record<string, unknown>;
        type : string;
        formatted : FormattedObject[]
    }) : Promise<void>;

    notifyError(data : {
        appId : string;
        icon : string|null;
        error : Error
    }) : Promise<void>;
}

interface NotificationBackend extends NotificationDelegate {
    readonly name : string;
    readonly uniqueId : string;
    readonly requiredSettings : string[];
}

const StaticNotificationBackends = {
    'twilio': TwilioNotificationBackend
};

export type NotificationConfig = {
    [T in keyof typeof StaticNotificationBackends] ?: ConstructorParameters<(typeof StaticNotificationBackends)[T]>[1]
}

/**
 * Helper class to adapt a Thingpedia device into a notification backend.
 */
class ThingpediaNotificationBackend implements NotificationBackend {
    private _iface : NotificationDelegate;
    name : string;
    uniqueId : string;

    constructor(device : Tp.BaseDevice) {
        this.name = device.name;
        this.uniqueId = 'thingpedia/' + device.uniqueId;
        this._iface = device.queryInterface('notifications') as NotificationDelegate;
    }

    get requiredSettings() {
        return [];
    }

    notify(data : {
        appId : string;
        icon : string|null;
        raw : Record<string, unknown>;
        type : string;
        formatted : FormattedObject[]
    }) {
        return this._iface.notify(data);
    }

    notifyError(data : {
        appId : string;
        icon : string|null;
        error : Error
    }) {
        return this._iface.notifyError(data);
    }
}

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

type ConverseInput = {
    type : 'command';
    text : string;
} | {
    type : 'parsed';
    json : any;
    title ?: string;
} | {
    type : 'tt';
    code : string;
};

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
    private _notificationDeviceView : DeviceView;
    private _nluModelUrl : string|undefined;

    private _notificationOutputs : Set<NotificationDelegate>;
    private _staticNotificationBackends : Record<string, NotificationBackend>;
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

        this._notificationDeviceView = new DeviceView(engine.devices, 'org.thingpedia.notification-provider', {});

        // initialize static notification backends
        this._staticNotificationBackends = {};
        for (const key in notificationConfig) {
            const key2 = key as keyof typeof StaticNotificationBackends;
            this._staticNotificationBackends[key] = new (StaticNotificationBackends[key2])(engine, notificationConfig[key2]!);
        }
    }

    async start() {
        this._notificationDeviceView.start();
    }
    async stop() {
        this._notificationDeviceView.stop();
    }

    /**
     * Dispatch one single command to an existing conversation.
     *
     * This is an alternative to getting the conversation and adding a
     * ConversationDelegate to it.
     * It exists for the convenience of REST API clients which do not keep
     * an open web socket.
     */
    async converse(command : ConverseInput, user : AssistantUser, conversationId : string) {
        const conversation = await this.getOrOpenConversation(conversationId, user, {
            showWelcome: false,
            anonymous: false,
            debug: true
        });
        const delegate = new StatelessConversationDelegate(conversationId);
        await conversation.addOutput(delegate, false);

        switch (command.type) {
        case 'command':
            await conversation.handleCommand(command.text);
            break;
        case 'parsed':
            await conversation.handleParsedCommand(command.json, command.title);
            break;
        case 'tt':
            await conversation.handleThingTalk(command.code);
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
    getAvailableNotificationBackends() : NotificationBackend[] {
        const backends = Object.values(this._staticNotificationBackends);
        for (const dev of this._notificationDeviceView.values())
            backends.push(new ThingpediaNotificationBackend(dev.queryInterface('notifications')));
        return backends;
    }

    /**
     * Dispatch a notification (a single new result from a stream) from a
     * ThingTalk program.
     *
     * @param appId - the unique ID of the running ThingTalk program
     * @param outputType - a string identifying the type of result to display
     * @param outputValue - the new value to display
     */
    async notify(appId : string, outputType : string, outputValue : Record<string, unknown>) {
        const prefs = this._engine.platform.getSharedPreferences();
        const notificationBackend = prefs.get('notification-backend') as string || 'conversation';
        const app = this._engine.apps.getApp(appId);
        // ignore if the app was stopped already
        if (!app)
            return;

        const promises = [];
        if (this._notificationOutputs.size > 0 || notificationBackend !== 'conversation') {
            const messages = await this._notificationFormatter.formatNotification(app.name, app.program, outputType, outputValue);

            const notification = {
                appId: appId,
                icon: app ? app.icon : null,
                raw: outputValue,
                type: outputType,
                formatted: messages
            };
            for (const out of this._notificationOutputs.values())
                promises.push(out.notify(notification));

            if (notificationBackend !== 'conversation') {
                if (notificationBackend.startsWith('thingpedia/')) {
                    const deviceId = notificationBackend.substring('thingpedia/'.length);
                    const device = this._notificationDeviceView.getById(deviceId);
                    if (device)
                        promises.push((device.queryInterface('notifications') as NotificationDelegate).notify(notification));
                } else {
                    const backend = this._staticNotificationBackends[notificationBackend];
                    if (backend)
                        promises.push(backend.notify(notification));
                }
            }
        }

        if (notificationBackend === 'conversation') {
            for (const conv of this._conversations.values())
                promises.push(conv.notify(appId, outputType, outputValue));
        }
        await Promise.all(promises);
    }

    async notifyError(appId : string, error : Error) {
        const prefs = this._engine.platform.getSharedPreferences();
        const notificationBackend = prefs.get('notification-backend') as string || 'conversation';
        const app = this._engine.apps.getApp(appId);
        // ignore if the app was stopped already
        if (!app)
            return;

        const promises = [];
        const notification = {
            appId: appId,
            icon: app ? app.icon : null,
            error: error
        };
        for (const out of this._notificationOutputs.values())
            promises.push(out.notifyError(notification));

        if (notificationBackend === 'conversation') {
            for (const conv of this._conversations.values())
                promises.push(conv.notifyError(appId, error));
        } else if (notificationBackend.startsWith('thingpedia/')) {
            const deviceId = notificationBackend.substring('thingpedia/'.length);
            const device = this._notificationDeviceView.getById(deviceId);
            if (device)
                promises.push((device.queryInterface('notifications') as NotificationDelegate).notifyError(notification));
        } else {
            const backend = this._staticNotificationBackends[notificationBackend];
            if (backend)
                promises.push(backend.notifyError(notification));
        }

        await Promise.all(promises);
    }

    getConversation(id ?: string) : Conversation|null {
        if (id !== undefined && this._conversations.has(id))
            return this._conversations.get(id)!;
        else
            return this._lastConversation;
    }

    async getOrOpenConversation(id : string, user : AssistantUser, options : ConversationOptions) {
        if (this._conversations.has(id))
            return this._conversations.get(id)!;
        options = options || {};
        if (!options.nluServerUrl)
            options.nluServerUrl = this._nluModelUrl;
        const conv = this.openConversation(id, user, options);
        await conv.start();
        return conv;
    }

    openConversation(id : string, user : AssistantUser, options : ConversationOptions) {
        this._conversations.delete(id);
        options = options || {};
        if (!options.nluServerUrl)
            options.nluServerUrl = this._nluModelUrl;

        let deleteWhenInactive = options.deleteWhenInactive;
        if (deleteWhenInactive === undefined)
            deleteWhenInactive = true;
        const conv = new Conversation(this._engine, id, user, options);
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
