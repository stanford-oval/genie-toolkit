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

import { MessageType } from "../protocol/message_type";

import { CustomPlayerSpec } from "./interface";

// Protocol types associated with the audio control protocol

export enum RequestType {
    CHECK_BACKEND = 'check',
    PREPARE = 'prepare',
    STOP = 'stop',
    PAUSE = 'pause',
    RESUME = 'resume',
    PLAY_URLS = 'play-urls',
    SET_VOLUME = 'set-volume',
    ADJUST_VOLUME = 'adj-volume',
    SET_MUTE = 'set-mute',
    SET_VOICE_INPUT = 'set-voice-input',
    SET_VOICE_OUTPUT = 'set-voice-output'
}

// server->client messages

export interface CheckBackendRequestMessage {
    type : MessageType.AUDIO_SUBPROTOCOL;
    op : RequestType.CHECK_BACKEND;

    /**
     * Serial number of the request
     */
    req : number;

    spec : CustomPlayerSpec;
}

export interface PrepareRequestMessage {
    type : MessageType.AUDIO_SUBPROTOCOL;
    op : RequestType.PREPARE;
    req : number;
    spec ?: CustomPlayerSpec;
}

export interface StopRequestMessage {
    type : MessageType.AUDIO_SUBPROTOCOL;
    op : RequestType.STOP;
    req : number;
}

export interface PauseRequestMessage {
    type : MessageType.AUDIO_SUBPROTOCOL;
    op : RequestType.PAUSE;
    req : number;
}

export interface ResumeRequestMessage {
    type : MessageType.AUDIO_SUBPROTOCOL;
    op : RequestType.RESUME;
    req : number;
}

export interface PlayURLMessage {
    type : MessageType.AUDIO_SUBPROTOCOL;
    op : RequestType.PLAY_URLS;
    req : number;
    urls : string[];
}

export interface SetVolumeMessage {
    type : MessageType.AUDIO_SUBPROTOCOL;
    op : RequestType.SET_VOLUME;
    req : number;
    volume : number;
}

export interface AdjustVolumeMessage {
    type : MessageType.AUDIO_SUBPROTOCOL;
    op : RequestType.ADJUST_VOLUME;
    req : number;
    delta : number;
}

export interface SetMuteMessage {
    type : MessageType.AUDIO_SUBPROTOCOL;
    op : RequestType.SET_MUTE;
    req : number;
    mute : boolean;
}

export interface SetVoiceInputMessage {
    type : MessageType.AUDIO_SUBPROTOCOL;
    op : RequestType.SET_VOICE_INPUT;
    req : number;
    input : boolean;
}

export interface SetVoiceOutputMessage {
    type : MessageType.AUDIO_SUBPROTOCOL;
    op : RequestType.SET_VOICE_OUTPUT;
    req : number;
    output : boolean;
}


export type ServerMessage =
    CheckBackendRequestMessage
    | PrepareRequestMessage
    | StopRequestMessage
    | PauseRequestMessage
    | ResumeRequestMessage
    | PlayURLMessage
    | SetVolumeMessage
    | AdjustVolumeMessage
    | SetMuteMessage
    | SetVoiceInputMessage
    | SetVoiceOutputMessage;


// client->server messages

/**
 * The result of a "check backend" operation.
 */
export interface CheckBackendResponseMessage {
    type : MessageType.AUDIO_SUBPROTOCOL;
    req : number;
    /**
     * Whether the backend was available and initialized successfully.
     */
    ok : boolean;
    /**
     * Detailed string of why the backend was not available, for logging.
     */
    detail ?: string;

    /**
     * Error associated with this operation, if any.
     *
     * This is only relevant for protocol errors, not errors related to
     * the initialization of the backend.
     */
    error ?: {
        /**
         * Human readable error message.
         *
         * The purpose of this error message is for logging and developer
         * use, not to be displayed directly to users.
         */
        message : string;

        /**
         * Error code, if available.
         */
        code ?: string;
    }
}

/**
 * The result of any other server-initiated operation.
 *
 * The operation was considered successful if the {@link error}
 * field is not present.
 */
export interface GenericResponseMessage {
    type : MessageType.AUDIO_SUBPROTOCOL;
    req : number;

    /**
     * Error associated with this operation, if any.
     */
    error ?: {
        /**
         * Human readable error message.
         *
         * The purpose of this error message is for logging and developer
         * use, not to be displayed directly to users.
         */
        message : string;

        /**
         * Error code, if available.
         */
        code ?: string;
    }
}

export type ClientMessage =
    CheckBackendResponseMessage
    | GenericResponseMessage;
