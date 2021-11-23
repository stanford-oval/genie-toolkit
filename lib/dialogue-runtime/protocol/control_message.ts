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

import { EntityMap } from '../../utils/entity-utils';

import { MessageType, SubprotocolType } from './message_type';

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
 * Enable a subprotocol on this connection
 */
export interface ClientRequestSubprotocolCommand {
    type : MessageType.REQUEST_SUBPROTOCOL,
    proto : SubprotocolType,
    caps : string[]
}
