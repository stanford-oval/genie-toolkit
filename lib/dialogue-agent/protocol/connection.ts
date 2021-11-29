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

import AssistantEngine from '../../engine';
import { EntityMap } from '../../utils/entity-utils';

import Conversation, { ConversationDelegate } from "../conversation";
import {
    ServerProtocolMessage,
    ClientProtocolMessage,
    Message,
    MessageType
} from ".";
import { SubprotocolType } from './message_type';
import CustomError from '../../utils/custom_error';
import AudioSubprotocolImplementation from '../audio/protocol_impl';

export interface SubprotocolImplementation {
    destroy() : void;
    handle(msg : any) : Promise<void>;
}

/**
 * A single connection from a conversation API client.
 *
 * This class implements the websocket-based protocol used by the server
 * and cloud platforms. It extends the conversation protocol with options
 * related to synchronizing devices, controlling audio, accessing the
 * user's location, and more.
 */
export default class ConversationWebSocketConnection implements ConversationDelegate {
    readonly send : (msg : ServerProtocolMessage) => Promise<void>;
    private _syncDevices : boolean;
    private _replayHistory : boolean;
    private _pingListener : () => void;
    private _deviceAddedListener : (d : Tp.BaseDevice) => void;
    private _conversation : Conversation;
    private _engine : AssistantEngine;
    private _subprotocols : Map<string, SubprotocolImplementation> = new Map;

    constructor(conversation : Conversation,
                sendCallback : (msg : ServerProtocolMessage) => Promise<void>,
                options : {
                    replayHistory ?: boolean
                    syncDevices ?: boolean
                } = {}) {
        this._conversation = conversation;
        this._engine = conversation.engine;
        this.send = sendCallback;

        this._syncDevices = options.syncDevices ?? false;
        this._replayHistory = options.replayHistory ?? true;
        this._deviceAddedListener = (d : Tp.BaseDevice) => {
            this._sendNewDevice(d).catch((e) => {
                console.error(`Failed to send notification of new device to client: ${e.message}`);

                if (e.code === 'ERR_SOCKET_CLOSED')
                    this.destroy();
            });
        };
        this._pingListener = () => {
            this.send({ type: MessageType.PING });
        };
    }

    get conversationId() {
        return this._conversation.id;
    }

    get engine() {
        return this._engine;
    }

    async start() {
        await this.send({ type: MessageType.ID, id: this._conversation.id });

        if (this._syncDevices) {
            for (const d of this._engine.devices.getAllDevices())
                await this._sendNewDevice(d);

            this._engine.devices.on('device-added', this._deviceAddedListener);
            this._engine.devices.on('device-changed', this._deviceAddedListener);
        }
        this._engine.activityMonitor.on('ping', this._pingListener);

        await this._conversation.addOutput(this, this._replayHistory);
    }

    destroy() {
        this._engine.assistant.closeConversation(this._conversation.id);
        this._conversation.removeOutput(this);
        if (this._syncDevices) {
            this._engine.devices.removeListener('device-added', this._deviceAddedListener);
            this._engine.devices.removeListener('device-changed', this._deviceAddedListener);
        }
        this._engine.activityMonitor.removeListener('ping', this._pingListener);

        for (const impl of this._subprotocols.values())
            impl.destroy();
    }

    private async _requestSubprotocol(proto : string, caps : string[]) {
        if (this._subprotocols.has(proto))
            throw new CustomError('EEXIST', `Subprotocol was already initialized`);

        switch (proto) {
        case SubprotocolType.AUDIO:
            this._subprotocols.set(SubprotocolType.AUDIO, new AudioSubprotocolImplementation(this, caps));
            break;

        default:
            throw new CustomError('EINVAL', `Invalid subprotocol type`);
        }
    }

    private _dispatchSubprotocol(proto : SubprotocolType, msg : ClientProtocolMessage) {
        const impl = this._subprotocols.get(proto);
        if (!impl)
            throw new CustomError('EINVAL', `Subprotocol not initialized`);
        return impl.handle(msg);
    }

    async handle(msg : ClientProtocolMessage) {
        try {
            switch (msg.type) {
            case MessageType.COMMAND:
                await this._conversation.handleCommand(msg.text, msg.platformData);
                break;
            case MessageType.PARSED_COMMAND:
                await this._conversation.handleParsedCommand(msg.json, msg.title, msg.platformData);
                break;
            case MessageType.THINGTALK_COMMAND:
                await this._conversation.handleThingTalk(msg.code, msg.platformData);
                break;
            case MessageType.PING:
                await this._engine.updateActivity();
                break;
            case MessageType.REQUEST_SUBPROTOCOL:
                await this._requestSubprotocol(msg.proto, msg.caps);
                break;
            case MessageType.AUDIO_SUBPROTOCOL:
                await this._dispatchSubprotocol(SubprotocolType.AUDIO, msg);
                break;
            default:
                await this.send({ type: MessageType.ERROR, message: 'Invalid message type', code: 'EINVAL' });
            }
        } catch(e) {
            await this.send({ type: MessageType.ERROR, message: e.message, code: e.code });
        }
    }

    setHypothesis(hypothesis : string) : Promise<void> {
        return this.send({ type: MessageType.HYPOTHESIS, hypothesis });
    }

    setExpected(what : string|null, context : {
        code : string[];
        entities : EntityMap;
    }) {
        return this.send({ type: MessageType.ASK_SPECIAL, ask: what, context });
    }

    addMessage(msg : Message) {
        return this.send(msg);
    }

    private async _sendNewDevice(device : Tp.BaseDevice) {
        return this.send({ type: MessageType.NEW_DEVICE, uniqueId: device.uniqueId!, state: device.serialize() });
    }
}
