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

import CustomError from "../../utils/custom_error";
import { MessageType } from "../protocol";
import type ConversationWebSocketConnection from "../protocol/connection";

import { AudioPlayer, CustomPlayerSpec } from "./interface";
import { CheckBackendResponseMessage, ClientMessage, GenericResponseMessage, RequestType, ServerMessage } from "./protocol";

/**
 * Implementation of the audio control protocol over the conversation
 * websocket connection.
 */
export default class AudioSubprotocolImplementation implements AudioPlayer {
    private _conn : ConversationWebSocketConnection;
    private _requests : Map<number, {
        resolve(x : ClientMessage) : void;
        reject(err : Error) : void;
    }>;
    private _nextReq = 0;

    constructor(connection : ConversationWebSocketConnection, caps : string[]) {
        this._conn = connection;
        this._requests = new Map;
        this._conn.engine.audio.addPlayer(this);
    }

    get conversationId() {
        return this._conn.conversationId;
    }

    destroy() {
        this._conn.engine.audio.removePlayer(this);
    }

    async handle(msg : ClientMessage) {
        const request = this._requests.get(msg.req);
        if (!request)
            throw new CustomError('EINVAL', `Invalid request number`);
        request.resolve(msg);
    }

    private _req(msg : ServerMessage) {
        return new Promise<ClientMessage>((resolve, reject) => {
            this._requests.set(msg.req, { resolve, reject });
            this._conn.send(msg).catch((e) => {
                reject(e);
            });
        });
    }

    private async _simpleReq(msg : ServerMessage) {
        const reply = (await this._req(msg)) as GenericResponseMessage;
        if (reply.error) {
            if (reply.error.code)
                throw new CustomError(reply.error.code, reply.error.message);
            else
                throw new Error(reply.error.message);
        }
    }

    async checkCustomPlayer(spec : CustomPlayerSpec) : Promise<boolean> {
        const msg = (await this._req({
            type: MessageType.AUDIO_SUBPROTOCOL,
            req: this._nextReq++,
            op: RequestType.CHECK_BACKEND,
            spec
        })) as CheckBackendResponseMessage;
        if (msg.error) {
            if (msg.error.code)
                throw new CustomError(msg.error.code, msg.error.message);
            else
                throw new Error(msg.error.message);
        }
        if (typeof msg.ok !== 'boolean') {
            this._conn.send({ type: MessageType.ERROR, code: 'EINVAL', message: `Invalid reply to check request` });
            return false;
        }
        if (!msg.ok)
            console.log(`Player of type ${spec.type} is not available on ${this.conversationId}: ${msg.detail}`);
        return msg.ok;
    }

    prepare(spec ?: CustomPlayerSpec) : Promise<void> {
        return this._simpleReq({
            type: MessageType.AUDIO_SUBPROTOCOL,
            req: this._nextReq++,
            op: RequestType.PREPARE,
            spec
        });
    }
    stop() : Promise<void> {
        return this._simpleReq({
            type: MessageType.AUDIO_SUBPROTOCOL,
            req: this._nextReq++,
            op: RequestType.STOP,
        });
    }
    pause() : Promise<void> {
        return this._simpleReq({
            type: MessageType.AUDIO_SUBPROTOCOL,
            req: this._nextReq++,
            op: RequestType.PAUSE,
        });
    }
    resume() : Promise<void> {
        return this._simpleReq({
            type: MessageType.AUDIO_SUBPROTOCOL,
            req: this._nextReq++,
            op: RequestType.RESUME,
        });
    }
    playURLs(urls : string[]) : Promise<void> {
        return this._simpleReq({
            type: MessageType.AUDIO_SUBPROTOCOL,
            req: this._nextReq++,
            op: RequestType.PLAY_URLS,
            urls,
        });
    }
    setVolume(volume : number) : Promise<void> {
        return this._simpleReq({
            type: MessageType.AUDIO_SUBPROTOCOL,
            req: this._nextReq++,
            op: RequestType.SET_VOLUME,
            volume
        });
    }
    adjustVolume(delta : number) : Promise<void> {
        return this._simpleReq({
            type: MessageType.AUDIO_SUBPROTOCOL,
            req: this._nextReq++,
            op: RequestType.ADJUST_VOLUME,
            delta
        });
    }
    setMute(mute : boolean) : Promise<void> {
        return this._simpleReq({
            type: MessageType.AUDIO_SUBPROTOCOL,
            req: this._nextReq++,
            op: RequestType.SET_MUTE,
            mute
        });
    }
    setVoiceInput(input : boolean) : Promise<void> {
        return this._simpleReq({
            type: MessageType.AUDIO_SUBPROTOCOL,
            req: this._nextReq++,
            op: RequestType.SET_VOICE_INPUT,
            input
        });
    }
    setVoiceOutput(output : boolean) : Promise<void> {
        return this._simpleReq({
            type: MessageType.AUDIO_SUBPROTOCOL,
            req: this._nextReq++,
            op: RequestType.SET_VOICE_OUTPUT,
            output
        });
    }
}
