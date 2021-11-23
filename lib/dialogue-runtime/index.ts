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

/**
 * The public APIs of the dialogue agent components of Genie.
 *
 * Exported for convenience of TypeScript users.
 */

export {
    NotificationDelegate,
    NotificationConfig,
} from './notifications';
export {
    default as AssistantDispatcher,
    ThingTalkInput,
    ParsedInput,
    CommandInput,
    ConverseInput
} from './assistant_dispatcher';
export {
    ConversationState,
    ConversationDelegate,
    ConversationOptions,
    default as Conversation
} from './conversation';
export * as Protocol from './protocol';
export * from './errors';
export { default as AudioController } from './audio/controller';
