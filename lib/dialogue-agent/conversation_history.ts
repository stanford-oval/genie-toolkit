// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2021 The Board of Trustees of the Leland Stanford Junior University
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

import { v4 as uuidv4 } from 'uuid';

import AssistantEngine from '../engine';
import { ConversationHistoryRow, LocalTable } from '../engine/db';

import { Message } from './protocol';

const IN_MEMORY_MESSAGES = 10;

/**
 * Wrap access to the conversation history in the database.
 *
 * This object keeps a buffer of messages in memory, but also
 * allows scrollback to previous messages.
 */
export default class ConversationHistory {
    private readonly _conversationId : string;
    private readonly _db : LocalTable<ConversationHistoryRow>;
    private _cache : Message[];

    constructor(engine : AssistantEngine, conversationId : string) {
        this._conversationId = conversationId;
        this._db = engine.db.getLocalTable('conversation_history');
        this._cache = [];
    }

    getCached() : Message[] {
        return this._cache;
    }

    async init() {
        const rows = await this._db.search({
            filter: [
                { k: 'conversationId', o: '=', v: this._conversationId }
            ],
            sort: ['messageId', 'desc'],
            limit: IN_MEMORY_MESSAGES
        });
        // reverse the order from what we loaded
        rows.reverse();

        this._cache = rows.map((r) => JSON.parse(r.message));
    }

    async addMessage(msg : Message) {
        await this._db.insertOne(uuidv4(), {
            conversationId: this._conversationId,
            messageId: msg.id!,
            message: JSON.stringify(msg)
        });
        this._cache.push(msg);
        if (this._cache.length > IN_MEMORY_MESSAGES)
            this._cache.shift();
    }

    async scrollBack(fromMessageId : number, scrollBackSize = 10) : Promise<Message[]> {
        const rows = await this._db.search({
            filter: [
                { k: 'conversationId', o: '=', v: this._conversationId },
                { k: 'messageId', o: '<', v: fromMessageId }
            ],
            sort: ['messageId', 'desc'],
            limit: scrollBackSize
        });
        // reverse the order from what we loaded
        rows.reverse();
        return rows.map((r) => JSON.parse(r.message));
    }
}
