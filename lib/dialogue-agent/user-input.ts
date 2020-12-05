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
import { Ast, Type, SchemaRetriever } from 'thingtalk';

import ValueCategory from './value-category';
import { EntityMap } from '../utils/entity-utils';
import * as ThingTalkUtils from '../utils/thingtalk';

export interface PlatformData {
    contacts ?: Array<{
        value : string;
        principal : string;
        display : string;
    }>;
}

export interface PreparsedCommand {
    code : string[];
    entities : EntityMap;
    slots ?: string[];
    slotTypes ?: Record<string, string>;
}

function parseSpecial(intent : Ast.SpecialControlIntent, context : { platformData : PlatformData }) {
    switch (intent.type) {
    case 'yes':
        return new UserInput.Answer(new Ast.Value.Boolean(true), context.platformData);
    case 'no':
        return new UserInput.Answer(new Ast.Value.Boolean(false), context.platformData);
    default:
        return new UserInput.UICommand(intent.type, context.platformData);
    }
}

/**
 * Base class for the interpretation of the input from the user, which could be
 * a UI action (a button) or a natural language command.
 */
class UserInput {
    platformData : PlatformData;

    constructor(platformData : PlatformData) {
        this.platformData = platformData;
    }

    static fromThingTalk(thingtalk : Ast.Input, context : { platformData : PlatformData }) : UserInput {
        if (thingtalk instanceof Ast.ControlCommand) {
            if (thingtalk.intent instanceof Ast.SpecialControlIntent)
                return parseSpecial(thingtalk.intent, context);
            else if (thingtalk.intent instanceof Ast.AnswerControlIntent)
                return new UserInput.Answer(thingtalk.intent.value, context.platformData);
            else if (thingtalk.intent instanceof Ast.ChoiceControlIntent)
                return new UserInput.MultipleChoiceAnswer(thingtalk.intent.value, context.platformData);
            else
                throw new TypeError(`Unrecognized bookkeeping intent`);
        } else if (thingtalk instanceof Ast.Program) {
            return new UserInput.Program(thingtalk, context.platformData);
        } else if (thingtalk instanceof Ast.DialogueState) {
            return new UserInput.DialogueState(thingtalk, context.platformData);
        } else {
            throw new TypeError(`Unrecognized ThingTalk command: ${thingtalk.prettyprint()}`);
        }
    }

    static async parse(json : { program : string }|PreparsedCommand,
                       thingpediaClient : Tp.BaseClient,
                       schemaRetriever : SchemaRetriever,
                       context : { platformData : PlatformData }) : Promise<UserInput> {
        if ('program' in json) {
            return UserInput.fromThingTalk(await ThingTalkUtils.parse(json.program, {
                thingpediaClient,
                schemaRetriever,
                loadMetadata: true
            }), context);
        }

        const { code, entities } = json;
        for (const name in entities) {
            if (name.startsWith('SLOT_')) {
                const slotname = json.slots![parseInt(name.substring('SLOT_'.length))];
                const slotType = Type.fromString(json.slotTypes![slotname]);
                const value = Ast.Value.fromJSON(slotType, entities[name]);
                entities[name] = value;
            }
        }

        const thingtalk = await ThingTalkUtils.parsePrediction(code, entities, {
            thingpediaClient,
            schemaRetriever,
            loadMetadata: true
        }, true);
        return UserInput.fromThingTalk(thingtalk, context);
    }
}

namespace UserInput {
    /**
     * A natural language command that was parsed correctly but is not supported in
     * Thingpedia (it uses Thingpedia classes that are not available).
     */
    export class Unsupported extends UserInput {}

    /**
     * A natural language command that failed to parse entirely.
     */
    export class Failed extends UserInput {
        constructor(public utterance : string,
                    platformData : PlatformData) {
            super(platformData);
        }
    }

    /**
     * A special command that bypasses the neural network, or a button on the UI.
     */
    export class UICommand extends UserInput {
        constructor(public type : string,
                    platformData : PlatformData) {
            super(platformData);
        }
    }

    /**
     * A multiple choice answer. This can be generated by the UI button,
     * or by the parser in multiple choice mode. It is only used to disambiguate
     * entities and device names
     */
    export class MultipleChoiceAnswer extends UserInput {
        category : ValueCategory.MultipleChoice = ValueCategory.MultipleChoice;

        constructor(public value : number,
                    platformData : PlatformData) {
            super(platformData);
        }
    }

    /**
     * A single, naked ThingTalk value. This can be generated by the UI pickers
     * (file pickers, location pickers, contact pickers, etc.), in certain uses
     * of the exact matcher, and when the agent is in raw mode.
     */
    export class Answer extends UserInput {
        category : ValueCategory;

        constructor(public value : Ast.Value,
                    platformData : PlatformData) {
            super(platformData);
            this.category = ValueCategory.fromValue(value);
        }
    }

    /**
     * A single ThingTalk program. This can come from a single-command neural network,
     * or from the user typing "\t".
     */
    export class Program extends UserInput {
        constructor(public program : Ast.Program,
                    platformData : PlatformData) {
            super(platformData);
        }
    }

    /**
     * A prediction ThingTalk dialogue state (policy, dialogue act, statements), which
     * is generated by the neural network after parsing the user's input.
     */
    export class DialogueState extends UserInput {
        constructor(public prediction : Ast.DialogueState,
                    platformData : PlatformData) {
            super(platformData);
        }
    }
}

export default UserInput;
