// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020-2021 The Board of Trustees of the Leland Stanford Junior University
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

import { PlatformData } from './platform_data';
export { PlatformData };
import { MessageType } from './message_type';
export { MessageType };
export { default as WebSocketConnection } from './connection';
export * from './chat_message';
export * from './control_message';

import * as Audio from '../audio/protocol';
export { Audio };

import { Message } from './chat_message';
import {
    ConversationIDMessage,
    PingMessage,
    HypothesisMessage,
    NewDeviceMessage,
    AskSpecialMessage,
    ErrorMessage,
    ClientRequestSubprotocolCommand,
} from './control_message';

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
    | ErrorMessage
    | Audio.ServerMessage;


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
    | ClientThingTalkCommand
    | ClientRequestSubprotocolCommand
    | Audio.ClientMessage;
