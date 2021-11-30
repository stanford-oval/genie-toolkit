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

import * as Tp from 'thingpedia';

import { SQLiteDatabase, SQLitePlatform } from './sqlite';
import { DatabaseProxy, DatabaseProxyConfig }  from './dbproxy';

export interface AbstractRow {
    uniqueId : string;
}

export interface AppRow {
    uniqueId : string;
    code : string;
    state : string;
    name : string;
    description : string;
}

export interface ChannelRow {
    uniqueId : string;
    value : string;
}

export interface DeviceRow {
    uniqueId : string;
    state : string;
}

export interface ConversationRow {
    uniqueId : string;
    conversationId : string;
    previousId : string|null;
    dialogueId : string;
    context : string|null;
    agent : string|null;
    agentTimestamp : string|null;
    agentTarget : string|null;
    intermediateContext : string|null;
    user : string;
    userTimestamp : string|null;
    userTarget : string;
    vote : string|null;
    comment : string|null;
}

export interface ConversationStateRow {
    uniqueId : string;
    dialogueState : string|null;
    lastMessageId : number;
    recording : boolean;
}

export interface ConversationHistoryRow {
    uniqueId : string;
    conversationId : string;
    messageId : number;
    message : string
}

export interface LocalTables {
    app : AppRow;
    channel : ChannelRow;
    conversation : ConversationRow;
    conversation_state : ConversationStateRow;
    conversation_history : ConversationHistoryRow;
}

export interface SyncTables {
    device : DeviceRow;
}

export interface SearchParams<RowType> {
    filter : Array<{
        k : keyof RowType,
        o : '=' | '>=' | '<=' | '<' | '>',
        v : string|number|boolean
    }>;
    sort : [keyof RowType, 'asc' | 'desc'];
    limit : number;
}

export interface LocalTable<RowType extends AbstractRow> {
    name : string;

    getAll() : Promise<RowType[]>;
    getOne(uniqueId : string) : Promise<RowType|undefined>;
    getBy(field : keyof RowType, value : string) : Promise<RowType[]>;
    search(search : SearchParams<RowType>) : Promise<RowType[]>;
    insertOne(uniqueId : string, row : Omit<RowType, "uniqueId">) : Promise<void>;
    deleteOne(uniqueId : string) : Promise<void>;
}

export type SyncRecord<RowType> = { [K in keyof RowType] : RowType[K]|null } & { uniqueId : string; lastModified : number };
export interface SyncAtReply<RowType> {
    lastModified : number;
    ourChanges : Array<SyncRecord<RowType>>;
    done : boolean[];
}

export interface SyncTable<RowType extends AbstractRow>{
    name : string;
    fields : ReadonlyArray<keyof RowType>;

    getAll() : Promise<RowType[]>;
    getOne(uniqueId : string) : Promise<RowType|undefined>;
    insertOne(uniqueId : string, row : Omit<RowType, "uniqueId">) : Promise<number>;
    deleteOne(uniqueId : string) : Promise<number>;

    getRaw() : Promise<Array<SyncRecord<RowType>>>;
    getChangesAfter(lastModified : number) : Promise<Array<SyncRecord<RowType>>>;
    handleChanges(changes : Array<SyncRecord<RowType>>) : Promise<boolean[]>;
    syncAt(lastModified : number, pushedChanges : Array<SyncRecord<RowType>>) : Promise<SyncAtReply<RowType>>;
    replaceAll(data : Array<SyncRecord<RowType>>) : Promise<void>;

    insertIfRecent(uniqueId : string, lastModified : number, row : Omit<RowType, "uniqueId">) : Promise<boolean>;
    deleteIfRecent(uniqueId : string, lastModified : number) : Promise<boolean>;
}

export interface AbstractDatabase {
    ensureSchema() : Promise<void>;

    getLocalTable<T extends keyof LocalTables>(name : T) : LocalTable<LocalTables[T]>;
    getSyncTable<T extends keyof SyncTables>(name : T) : SyncTable<SyncTables[T]>;
}

export function createDB(platform : Tp.BasePlatform) : AbstractDatabase {
    // use database proxy if it's configured in the platform
    if (platform.hasCapability('database-proxy'))
        return new DatabaseProxy(platform.getCapability('database-proxy') as DatabaseProxyConfig);

    const sqliteplatform = platform as SQLitePlatform;
    return new SQLiteDatabase(sqliteplatform);
}
