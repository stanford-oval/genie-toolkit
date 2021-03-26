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


export enum MessageType {
    // from user
    COMMAND = 'command',

    // from agent
    TEXT = 'text',
    PICTURE = 'picture',
    CHOICE = 'choice',
    LINK = 'link',
    BUTTON = 'button',
    RDL = 'rdl',
    NEW_PROGRAM = 'new-program',
    SOUND_EFFECT = 'sound',
    AUDIO = 'audio',
    VIDEO = 'video'
}

interface TextMessage {
    id ?: number;
    type : MessageType.TEXT;
    text : string;
    icon : string|null;
}

interface CommandMessage {
    id ?: number;
    type : MessageType.COMMAND;
    command : string;
    json ?: any;
}

interface MediaMessage {
    id ?: number;
    type : MessageType.PICTURE|MessageType.AUDIO|MessageType.VIDEO;
    url : string;
    alt ?: string;
    icon : string|null;
}

export interface RDL {
    displayTitle : string;
    displayText ?: string;
    webCallback : string;
    callback ?: string;
}

interface RDLMessage {
    id ?: number;
    type : MessageType.RDL;
    rdl : RDL;
    icon : string|null;
}

interface SoundEffectMessage {
    id ?: number;
    type : MessageType.SOUND_EFFECT;
    name : string;
    exclusive : boolean;
    icon : string|null;
}

interface ChoiceMessage {
    id ?: number;
    type : MessageType.CHOICE;
    idx : number;
    title : string;
}

interface LinkMessage {
    id ?: number;
    type : MessageType.LINK;
    url : string;
    title : string;
}

interface ButtonMessage {
    id ?: number;
    type : MessageType.BUTTON;
    json : string;
    title : string;
}

interface NewProgramMessage {
    id ?: number;
    type : MessageType.NEW_PROGRAM;
    uniqueId : string;
    name : string;
    code : string;
    results : Array<Record<string, unknown>>;
    errors : string[];
    icon : string|null;
}

export type Message = TextMessage
    | CommandMessage
    | MediaMessage
    | RDLMessage
    | SoundEffectMessage
    | ChoiceMessage
    | LinkMessage
    | ButtonMessage
    | NewProgramMessage;
