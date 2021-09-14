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

import AssistantEngine from '../engine';
import { EntityMap } from '../utils/entity-utils';

import Conversation, { ConversationDelegate } from "./conversation";
import {
    ServerProtocolMessage,
    ClientProtocolMessage,
    Message,
    MessageType
} from "./protocol";

/**
 * A single connection from a conversation API client.
 *
 * This class implements the websocket-based protocol used by the server
 * and cloud platforms. It extends the conversation protocol with options
 * related to synchronizing devices, controlling audio, accessing the
 * user's location, and more.
 */
export default class ConversationWebSocketConnection implements ConversationDelegate {
    private _send : (msg : ServerProtocolMessage) => Promise<void>;
    private _syncDevices : boolean;
    private _pingListener : () => void;
    private _deviceAddedListener : (d : Tp.BaseDevice) => void;
    private _conversation : Conversation;
    private _engine : AssistantEngine;

    constructor(conversation : Conversation,
                sendCallback : (msg : ServerProtocolMessage) => Promise<void>,
                options : { syncDevices ?: boolean } = {}) {
        this._conversation = conversation;
        this._engine = conversation.engine;
        this._send = sendCallback;

        this._syncDevices = options.syncDevices ?? false;
        this._deviceAddedListener = (d : Tp.BaseDevice) => {
            this._sendNewDevice(d);
        };
        this._pingListener = () => {
            this._send({ type: MessageType.PING });
        };
    }

    async start() {
        await this._send({ type: MessageType.ID, id: this._conversation.id });

        if (this._syncDevices) {
            for (const d of this._engine.devices.getAllDevices())
                await this._sendNewDevice(d);

            this._engine.devices.on('device-added', this._deviceAddedListener);
            this._engine.devices.on('device-changed', this._deviceAddedListener);
        }
        this._engine.activityMonitor.on('ping', this._pingListener);

        await this._conversation.addOutput(this);
    }

    async stop() {
        await this._conversation.removeOutput(this);
        if (this._syncDevices) {
            this._engine.devices.removeListener('device-added', this._deviceAddedListener);
            this._engine.devices.removeListener('device-changed', this._deviceAddedListener);
        }
        this._engine.activityMonitor.removeListener('ping', this._pingListener);
    }

    async handle(msg : ClientProtocolMessage) {
        try {
            switch (msg.type) {
            case 'command':
                await this._conversation.handleCommand(msg.text, msg.platformData);
                break;
            case 'parsed':
                await this._conversation.handleParsedCommand(msg.json, msg.title, msg.platformData);
                break;
            case 'tt':
                await this._conversation.handleThingTalk(msg.code, msg.platformData);
                break;
            case 'ping':
                await this._engine.updateActivity();
                break;
            default:
                await this._send({ type: MessageType.ERROR, message: 'Invalid message type', code: 'EINVAL' });
            }
        } catch(e) {
            await this._send({ type: MessageType.ERROR, message: e.message, code: e.code });
        }
    }

    setHypothesis(hypothesis : string) : Promise<void> {
        return this._send({ type: MessageType.HYPOTHESIS, hypothesis });
    }

    setExpected(what : string|null, context : {
        code : string[];
        entities : EntityMap;
    }) {
        return this._send({ type: MessageType.ASK_SPECIAL, ask: what, context });
    }

    addMessage(msg : Message) {
        return this._send(msg);
    }

    private _sendNewDevice(device : Tp.BaseDevice) {
        return this._send({ type: MessageType.NEW_DEVICE, uniqueId: device.uniqueId!, state: device.serialize() });
    }
}
