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

import assert from 'assert';
import { MessageType } from '../../lib/dialogue-agent/protocol';

export default async function testConversationState(engine) {
    const conversationId = 'mock';
    const command = { type: MessageType.COMMAND, text: 'command' };

    const conversation = await engine.assistant.getOrOpenConversation(conversationId, {
        showWelcome: false,
        anonymous: false,
        debug: true
    });

    const state_0 = conversation.getState();

    await conversation.addMessage({ type: MessageType.COMMAND, command });
    await conversation.addMessage({ type: MessageType.COMMAND, command });

    // conversation state should have two more messages
    const state_1 = await engine.assistant.getConversationState(conversationId);
    console.log(state_1, state_0);
    assert.strictEqual(state_1.lastMessageId, state_0.lastMessageId+2);

    await engine.close();

    await engine.open();
    const restored = await engine.assistant.getOrOpenConversation(conversationId);

    // conversation should resume from last message id
    const state_2 = restored.getState();
    assert.strictEqual(state_2.lastMessageId, state_0.lastMessageId+2);

    await conversation.addMessage({ type: MessageType.COMMAND, command });
    const state_3 = restored.getState();
    assert.strictEqual(state_3.lastMessageId, state_0.lastMessageId+2+1);
}
