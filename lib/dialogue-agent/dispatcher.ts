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

import Conversation, {
    AssistantUser,
    ConversationDelegate,
    ConversationOptions
} from './conversation';
import { Message } from './protocol';
import TextFormatter, { FormattedChunk } from './card-output/text-formatter';

import type Engine from '../engine';

interface NotificationDelegate {
    notify(data : {
        appId : string;
        icon : string|null;
        raw : Record<string, unknown>;
        type : string;
        formatted : FormattedChunk[]
    }) : Promise<void>;

    notifyError(data : {
        appId : string;
        icon : string|null;
        error : Error
    }) : Promise<void>;
}

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

export default class Assistant extends events.EventEmitter {
    private _engine : Engine;
    private _formatter : TextFormatter;
    private _nluModelUrl : string|undefined;

    private _outputs : Set<NotificationDelegate>;
    private _conversations : Map<string, Conversation>;
    private _lastConversation : Conversation|null;

    constructor(engine : Engine, nluModelUrl ?: string) {
        super();

        this._engine = engine;
        this._formatter = new TextFormatter(engine.platform.locale, engine.platform.timezone,
            engine.schemas);
        this._nluModelUrl = nluModelUrl;
        this._outputs = new Set;
        this._conversations = new Map;
        this._lastConversation = null;
    }

    async start() {}
    async stop() {}

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

    addNotificationOutput(output : NotificationDelegate) {
        this._outputs.add(output);
    }
    removeNotificationOutput(output : NotificationDelegate) {
        this._outputs.delete(output);
    }

    async notifyAll(appId : string, icon : string|null, outputType : string, outputValue : Record<string, unknown>) {
        const promises = [];
        if (this._outputs.size > 0) {
            const messages = await this._formatter.formatForType(outputType, outputValue, 'messages');
            for (const out of this._outputs.values()) {
                promises.push(out.notify({
                    appId: appId,
                    icon: icon,
                    raw: outputValue,
                    type: outputType,
                    formatted: messages
                }));
            }
        }

        for (const conv of this._conversations.values())
            promises.push(conv.notify(appId, icon, outputType, outputValue));
        await Promise.all(promises);
    }

    async notifyErrorAll(appId : string, icon : string|null, error : Error) {
        const promises = [];
        for (const out of this._outputs.values()) {
            promises.push(out.notifyError({
                appId: appId,
                icon: icon,
                error: error
            }));
        }
        for (const conv of this._conversations.values())
            promises.push(conv.notifyError(appId, icon, error));
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
