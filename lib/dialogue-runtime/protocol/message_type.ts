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
    ERROR = 'error',
    REQUEST_SUBPROTOCOL = 'req-subproto',

    // subprotocol identifiers
    AUDIO_SUBPROTOCOL = 'protocol:audio'
}

/**
 * Extension protocols
 *
 * These allows various components in Genie
 * to piggy-back into the conversation websocket,
 * avoiding a different connection to the server.
 */
export enum SubprotocolType {
    AUDIO = 'audio'
}
