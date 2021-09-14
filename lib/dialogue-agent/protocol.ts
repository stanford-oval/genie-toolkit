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

import { EntityMap } from '../utils/entity-utils';

import { ConversationState } from './conversation';

/**
 * Additional platform-specific metadata associated with each command from the user.
 */
export interface PlatformData {
    /**
     * The originator of this command.
     *
     * This should be a principal string, consisting of a prefix indicating
     * the protocol, followed by an account identifier.
     *
     * Examples:
     * - `phone:+1555123456`: command received over SMS
     * - `email:bob@example.com`: received over email
     */
    from ?: string;

    /**
     * Any contact mention in the command that were resolved by the platform.
     *
     * This property allows to support interactive @-mentions in a command,
     * similar to those available on typical messengers.
     *
     * The expectation is that the actual mention in the command will be replaced
     * by @ followed by an opaque identifier, which will be picked up by the
     * tokenizer. This array maps the opaque identifier to an actual contact.
     */
    contacts ?: Array<{
        /**
         * The opaque identifier of this contact in the command.
         */
        value : string;
        /**
         * The contact string, of the form protocol`:`identifier
         */
        principal : string;
        /**
         * The user-visible name of this contact, for subsequent references.
         */
        display : string;
    }>;
}

export enum MessageType {
    // from user
    COMMAND = 'command',
    PARSED_COMMAND = 'parsed',
    THINGTALK_COMMAND = 'tt',

    // from agent
    TEXT = 'text',
    PICTURE = 'picture',
    CHOICE = 'choice',
    LINK = 'link',
    BUTTON = 'button',
    RDL = 'rdl',
    SOUND_EFFECT = 'sound',
    AUDIO = 'audio',
    VIDEO = 'video',
    NEW_PROGRAM = 'new-program',

    // control messages
    ID = 'id',
    PING = 'ping',
    NEW_DEVICE = 'new-device',
    HYPOTHESIS = 'hypothesis',
    ASK_SPECIAL = 'askSpecial',
    ERROR = 'error'
}

export interface TextMessage {
    id ?: number;
    type : MessageType.TEXT;
    text : string;
    icon : string|null;
}

export interface CommandMessage {
    id ?: number;
    type : MessageType.COMMAND;
    command : string;
    json ?: any;
}

export interface MediaMessage {
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
    pictureUrl ?: string;
}

export interface RDLMessage {
    id ?: number;
    type : MessageType.RDL;
    rdl : RDL;
    icon : string|null;
}

export interface SoundEffectMessage {
    id ?: number;
    type : MessageType.SOUND_EFFECT;
    name : string;
    exclusive : boolean;
    icon : string|null;
}

export interface ChoiceMessage {
    id ?: number;
    type : MessageType.CHOICE;
    idx : number;
    title : string;
}

export interface LinkMessage {
    id ?: number;
    type : MessageType.LINK;
    url : string;
    title : string;

    /**
     * Conversation state associated with this link message.
     *
     * This is added to link messages to enable transparent
     * transfer of conversations across registration and
     * configuration flows.
     */
    state : ConversationState;
}

export interface ButtonMessage {
    id ?: number;
    type : MessageType.BUTTON;
    json : string;
    title : string;
}

export interface NewProgramMessage {
    id ?: number;
    type : MessageType.NEW_PROGRAM;
    uniqueId : string;
    name : string;
    code : string;
    results : Array<Record<string, unknown>>;
    errors : string[];
    icon : string|null;
}

/**
 * A message (chat bubble) from either the user or the agent.
 *
 * Objects of this type are included in the conversation history.
 *
 * They correspond to protocol messages sent from the server to
 * the client when the server replays the history, or when a
 * new message is added to the history.
 */
export type Message =
      TextMessage
    | CommandMessage
    | MediaMessage
    | RDLMessage
    | SoundEffectMessage
    | ChoiceMessage
    | LinkMessage
    | ButtonMessage
    | NewProgramMessage;


export interface ConversationIDMessage {
    type : MessageType.ID,
    id : string;
}

export interface PingMessage {
    type : MessageType.PING;
}

export interface AskSpecialMessage {
    type : MessageType.ASK_SPECIAL;
    ask : string|null;
    context : {
        code : string[];
        entities : EntityMap;
    }
}

export interface HypothesisMessage {
    type : MessageType.HYPOTHESIS;
    hypothesis : string;
}

export interface NewDeviceMessage {
    type : MessageType.NEW_DEVICE;
    uniqueId : string;
    state : Tp.BaseDevice.DeviceState;
}

export interface ErrorMessage {
    type : MessageType.ERROR;
    message : string;
    code ?: string;
}

/**
 * A single JSON object sent from the server to client.
 */
export type ServerProtocolMessage =
    Message
    | ConversationIDMessage
    | PingMessage
    | HypothesisMessage
    | NewDeviceMessage
    | AskSpecialMessage
    | ErrorMessage;

export interface ClientTextCommand {
    type : MessageType.COMMAND;
    text : string;
    platformData ?: PlatformData;
}

export interface ClientParsedCommand {
    type : MessageType.PARSED_COMMAND;
    json : any;
    title ?: string;
    platformData ?: PlatformData;
}

export interface ClientThingTalkCommand {
    type : MessageType.THINGTALK_COMMAND;
    code : string;
    platformData ?: PlatformData;
}

/**
 * A single JSON object sent from the client to the server.
 */
export type ClientProtocolMessage =
    PingMessage
    | ClientTextCommand
    | ClientParsedCommand
    | ClientThingTalkCommand;
