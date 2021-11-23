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
// Author: Silei Xu <silei@cs.stanford.edu>
//         Kevin Tang
//         Giovanni Campagna <gcampagn@cs.stanford.edu>

import { v4 as uuidv4 } from 'uuid';

import { DialogueExample, DialogueTurn } from "../dataset-tools/parsers";
import { ConversationRow, LocalTable } from "../engine/db";

class DialogueTurnLog {
    private readonly _conversationDB : LocalTable<ConversationRow>;
    private readonly _turn : DialogueTurn;
    private _conversationId : string;
    private _dialogueId : string;
    private _uniqueId : string;
    private _previousId : string|null;
    private _anyData : boolean;

    constructor(conversationDB : LocalTable<ConversationRow>,
                conversationId : string,
                dialogueId : string,
                previousId : string|null) {
        this._conversationDB = conversationDB;
        this._turn = {
            context: null,
            agent: null,
            agent_target: null,
            intermediate_context: null,
            user: '',
            user_target: ''
        };
        this._conversationId = conversationId;
        this._dialogueId = dialogueId;
        this._uniqueId = uuidv4();
        this._previousId = previousId;
        this._anyData = false;
    }

    get uniqueId() {
        return this._uniqueId;
    }

    async save() {
        // a fully empty turn occurs at the end of the dialogue if the user says
        // $stop, because we terminate the turn after the user speech, then the
        // agent speaks exactly nothing, and then we terminate the whole dialogue
        // we don't want to save the empty turn in that case
        if (!this._anyData)
            return;

        const agentTimestamp = this._turn.agent_timestamp ?
            this._turn.agent_timestamp!.toISOString() :
            null;
        const userTimestamp = this._turn.user_timestamp ?
            this._turn.user_timestamp!.toISOString() :
            null;
        const vote = this._turn.vote ?? null;
        const comment = this._turn.comment ?? null;
        const row = {
            conversationId: this._conversationId,
            previousId: this._previousId,
            dialogueId: this._dialogueId,
            context: this._turn.context,
            agent: this._turn.agent,
            agentTimestamp: agentTimestamp,
            agentTarget: this._turn.agent_target,
            intermediateContext: this._turn.intermediate_context,
            user: this._turn.user,
            userTimestamp: userTimestamp,
            userTarget: this._turn.user_target,
            vote: vote,
            comment: comment
        };
        await this._conversationDB.insertOne(this._uniqueId, row);
    }

    update(field : Exclude<keyof DialogueTurn,'agent_timestamp'|'user_timestamp'>, value : string) {
        this._turn[field] = this._turn[field] ? this._turn[field] + '\n' + value : value;
        if (field === 'user')
            this._turn.user_timestamp = new Date;
        else if (field === 'agent')
            this._turn.agent_timestamp = new Date;
        this._anyData = true;
    }
}

function* reorderTurns(rows : ConversationRow[]) : IterableIterator<DialogueTurn> {
    interface TurnWithNext {
        turn : DialogueTurn,
        next : TurnWithNext|null
    }
    const turns = new Map<string, TurnWithNext>();

    for (const row of rows) {
        turns.set(row.uniqueId, {
            turn: {
                context: row.context,
                agent: row.agent,
                agent_target: row.agentTarget,
                agent_timestamp: row.agentTimestamp ? new Date(row.agentTimestamp) : undefined,
                intermediate_context: row.intermediateContext,
                user: row.user,
                user_target: row.userTarget,
                user_timestamp: row.userTimestamp ? new Date(row.userTimestamp) : undefined,
                vote: row.vote ?? undefined,
                comment: row.comment ?? undefined
            },
            next: null
        });
    }

    let first : TurnWithNext|null = null;
    for (const row of rows) {
        if (row.previousId === null)
            first = turns.get(row.uniqueId)!;
        else
            turns.get(row.previousId)!.next = turns.get(row.uniqueId)!;
    }

    let turn = first;
    while (turn !== null) {
        yield turn.turn;
        turn = turn.next;
    }
}

function reconstructDialogues(rows : ConversationRow[]) : Iterable<DialogueExample> {
    if (rows.length === 0)
        return [];

    const conversationId = rows[0].conversationId;
    const dialogues = new Map<string, ConversationRow[]>();

    for (const row of rows) {
        const existing = dialogues.get(row.dialogueId);
        if (existing)
            existing.push(row);
        else
            dialogues.set(row.dialogueId, [row]);
    }

    const sorted = [];
    for (const [dialogueId, rows] of dialogues) {
        const turns = Array.from(reorderTurns(rows));
        sorted.push({
            id : conversationId + '/' + dialogueId,
            timestamp: turns[0].user_timestamp || turns[0].agent_timestamp,
            turns: turns,
        });
    }
    sorted.sort((one, two) => one.timestamp!.getTime() - two.timestamp!.getTime());

    return sorted;
}

export default class ConversationLogger {
    private readonly _conversationDB : LocalTable<ConversationRow>;
    private _conversationId : string;
    private _dialogueUniqueId : string;
    private _currentTurn : DialogueTurnLog;
    private _lastTurn : DialogueTurnLog;

    constructor(conversationDB : LocalTable<ConversationRow>,
                conversationId : string) {
        this._conversationDB = conversationDB;
        this._conversationId = conversationId;
        this._dialogueUniqueId = uuidv4();
        this._currentTurn = new DialogueTurnLog(this._conversationDB, this._conversationId, this._dialogueUniqueId, null);
        this._lastTurn = this._currentTurn;
    }

    async dialogueFinished() {
        await this._currentTurn.save();
        this._dialogueUniqueId = uuidv4();
        this._currentTurn = new DialogueTurnLog(this._conversationDB, this._conversationId, this._dialogueUniqueId, null);
        // do not update lastTurn here, it should continue to point to the previous turn so we can update the votes
        // for the agent speech right at the end of the dialogue
    }

    async turnFinished() {
        await this._currentTurn.save();
        const previousId = this._currentTurn.uniqueId;
        this._currentTurn = new DialogueTurnLog(this._conversationDB, this._conversationId, this._dialogueUniqueId, previousId);
        this._lastTurn = this._currentTurn;
    }

    async voteLast(vote : 'up'|'down') {
        this._lastTurn.update('vote', vote);
        await this._lastTurn.save();
    }

    async commentLast(comment : string) {
        this._lastTurn.update('comment', comment);
        await this._lastTurn.save();
    }

    updateLog(field : Exclude<keyof DialogueTurn,'agent_timestamp'|'user_timestamp'>, value : string) {
        this._currentTurn.update(field, value);
    }

    async *read() : AsyncIterableIterator<DialogueExample> {
        const rows = await this._conversationDB.getBy('conversationId', this._conversationId);
        yield* reconstructDialogues(rows);
    }
}
