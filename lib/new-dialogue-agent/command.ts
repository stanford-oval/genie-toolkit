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

import assert from 'assert';
import { Ast } from 'thingtalk';

const TRANSACTION_POLICY = 'org.thingpedia.dialogue.transaction';

/**
 * Coarse classification of the kind of command issued by a user.
 */
export enum CommandType {
    THINGTALK_QUERY,
    THINGTALK_ACTION,
    THINGTALK_STREAM
}

function getCommandType(cmd : Ast.ExpressionStatement) : CommandType {
    switch (cmd.expression.schema!.functionType) {
    case 'query':
        return CommandType.THINGTALK_QUERY;
    case 'action':
        return CommandType.THINGTALK_ACTION;
    case 'stream':
    default:
        return CommandType.THINGTALK_STREAM;
    }
}

/**
 * Data structure containing a parsed command from the user.
 */
 export class Command {
    /**
     * The actual underlying utterance from the user.
     */
    readonly utterance : string;

    /**
     * The coarse type of the command.
     *
     * This will be a string containing the fully qualified dialogue act, unless the dialogue act
     * is `org.thingpedia.dialogue.transaction.execute`, in which case it will be a
     * {@link CommandType}.
     */
    readonly type : CommandType|string;

    /**
     * The dialogue state associated with the command.
     */
    readonly state : Ast.DialogueState;

    /**
     * The ThingTalk program (sequence of executable statements) associated with the command.
     */
    readonly program : Ast.Program|null;

    constructor(utterance : string, state : Ast.DialogueState) {
        this.utterance = utterance;
        this.state = state;

        assert(state.history.every((item) => item.results === null));
        if (this.state.history.length > 0)
            this.program = new Ast.Program(null, [], [], [this.state.history[0].stmt]);
        else
            this.program = null;

        if (this.state.policy === TRANSACTION_POLICY &&
            this.state.dialogueAct === 'execute') {
            if (this.state.history.length > 0)
                this.type = getCommandType(this.state.history[0].stmt);
            else
                this.type = TRANSACTION_POLICY + '.invalid';
        } else {
            this.type = this.state.policy + '.' + this.state.dialogueAct;
        }
    }

    /**
     * The dialogue act associated with the command.
     *
     * This is a convenience accessor over getting {@link state}.dialogueAct
     */
    get dialogueAct() {
        return this.state.dialogueAct;
    }
}
