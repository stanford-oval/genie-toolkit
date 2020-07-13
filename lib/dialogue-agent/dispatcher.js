// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
"use strict";

const assert = require('assert');
const events = require('events');

const Conversation = require('./conversation');
const { MessageType } = require('./protocol');

class StatelessConversationDelegate {
    constructor() {
        this._buffer = [];
        this._askSpecial = null;
    }

    flush() {
        const buffer = this._buffer;
        const askSpecial = this._askSpecial;
        this._buffer = [];
        this._askSpecial = null;
        return {
            messages: buffer,
            askSpecial: askSpecial,
        };
    }

    setHypothesis() {
        // ignore
    }

    addMessage(message) {
        if (message.type === MessageType.ASK_SPECIAL) {
            assert(this._askSpecial === null);
            this._askSpecial = message.askSpecialType;
        } else {
            this._buffer.push(message);
        }
    }
}

module.exports = class Assistant extends events.EventEmitter {
    constructor(engine) {
        super();

        this._engine = engine;
        this._outputs = new Set;
        this._conversations = new Map;
        this._lastConversation = null;
    }

    async start() {}
    async stop() {}

    async converse(command, user, conversationId) {
        const conversation = await this.getOrOpenConversation(conversationId, user, {
            showWelcome: false,
            anonymous: false
        });
        const delegate = new StatelessConversationDelegate();
        await conversation.addOutput(delegate, false);

        switch (command.type) {
        case 'command':
            await conversation.handleCommand(command.text);
            break;
        case 'parsed':
            await conversation.handleParsedCommand(command.json);
            break;
        case 'tt':
            await conversation.handleThingTalk(command.code);
            break;
        default:
            throw new Error('Invalid command type ' + command.type);
        }

        await conversation.removeOutput(delegate);
        const result = delegate.flush();
        result.conversationId = conversation.id;
        return result;
    }

    addNotificationOutput(output) {
        this._outputs.add(output);
    }
    removeNotificationOutput(output) {
        this._outputs.delete(output);
    }

    async notifyAll(...data) {
        const promises = [];
        for (let out of this._outputs.values())
            promises.push(out.notify(...data));
        for (let conv of this._conversations.values())
            promises.push(conv.notify(...data));
        await Promise.all(promises);
    }

    async notifyErrorAll(...data) {
        const promises = [];
        for (let out of this._outputs.values())
            promises.push(out.notifyError(...data));
        for (let conv of this._conversations.values())
            promises.push(conv.notifyError(...data));
        await Promise.all(promises);
    }

    getConversation(id) {
        if (id !== undefined && this._conversations.has(id))
            return this._conversations.get(id);
        else
            return this._lastConversation;
    }

    async getOrOpenConversation(id, user, options) {
        if (this._conversations.has(id))
            return this._conversations.get(id);
        options = options || {};
        options.sempreUrl = this._url;
        let conv = this.openConversation(id, user, options);
        await conv.start();
        return conv;
    }

    openConversation(id, user, options) {
        this._conversations.delete(id);
        options = options || {};
        options.sempreUrl = this._url;
        const conv = new Conversation(this._engine, id, user, options);
        conv.on('active', () => {
            this._lastConversation = conv;
        });
        conv.on('inactive', () => {
            if (this._conversations.get(conv.id) === conv)
                this._conversations.delete(conv.id);
        });
        this._lastConversation = conv;
        this._conversations.set(id, conv);
        return conv;
    }

    closeConversation(id) {
        this._conversations.delete(id);
    }
};
