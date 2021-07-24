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

import * as ThingTalkUtils from '../utils/thingtalk';
import { POLICY_NAME as TRANSACTION_POLICY } from '../templates/transactions';

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
     * The dialogue state before the command was issued.
     *
     * This will be null if this is the first command in the dialogue.
     */
    readonly context : Ast.DialogueState|null;

    /**
     * The formal representation of the command.
     */
    readonly prediction : Ast.DialogueState;

    /**
     * The dialogue state immediately after the command.
     */
    readonly state : Ast.DialogueState;

    /**
     * The ThingTalk program (sequence of executable statements) associated with the command.
     */
    readonly program : Ast.Program|null;

    constructor(utterance : string, context : Ast.DialogueState|null, prediction : Ast.DialogueState) {
        this.utterance = utterance;
        this.context = context;
        this.prediction = prediction;
        assert(prediction.history.every((item) => item.results === null));
        if (prediction.history.length > 0)
            this.program = new Ast.Program(null, [], [], [prediction.history[0].stmt]);
        else
            this.program = null;

        if (prediction.policy === TRANSACTION_POLICY &&
            prediction.dialogueAct === 'execute') {
            if (prediction.history.length > 0)
                this.type = getCommandType(prediction.history[0].stmt);
            else
                this.type = TRANSACTION_POLICY + '.invalid';
        } else {
            this.type = prediction.policy + '.' + prediction.dialogueAct;
        }

        this.state = ThingTalkUtils.computeNewState(context, prediction, 'user');
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
