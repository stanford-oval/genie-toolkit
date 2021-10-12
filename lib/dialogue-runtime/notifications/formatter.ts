// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2018-2020 The Board of Trustees of the Leland Stanford Junior University
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
import * as ThingTalk from 'thingtalk';

import Engine from '../../engine';
import { LogLevel } from '../../sentence-generator/runtime';
import InferenceTimeThingTalkExecutor from '../../thingtalk-dialogues/inference-thingtalk-executor';
import { InferenceTimeDialogue } from '../../thingtalk-dialogues/inference-time-dialogue';

import { FORMAT_TYPES } from '../card-output/format_objects';

/**
 * An object that is able to convert structured ThingTalk results
 * into a textual representation suitable to send as a notification
 * or a message.
 *
 * This is used to implement `$result` ThingTalk, and to dispatch
 * notifications to third-party services like Twilio.
 *
 * Internally, it uses the transaction state machine, which is
 * instantiated with a special state for every result.
 */
export default class NotificationFormatter {
    private _dlg : InferenceTimeDialogue;

    /**
     * Construct a new formatter for a given Genie engine.
     */
    constructor(engine : Engine) {
        const executor = new InferenceTimeThingTalkExecutor(engine, {
            id: 'notification',
            async sendNewProgram() {}
        }, false);
        this._dlg = new InferenceTimeDialogue({
            thingpediaClient: engine.thingpedia,
            schemaRetriever: engine.schemas,
            locale: engine.platform.locale,
            timezone: engine.platform.timezone,
            policy: undefined,
            useConfidence: false,
            executor: executor,
            extraFlags: {},
            anonymous: false,
            debug: LogLevel.INFO,
            rng: Math.random
        });
    }

    async initialize() {
        await this._dlg.initialize(undefined, false);
    }

    async formatNotification(appName : string|null, program : ThingTalk.Ast.Program, outputType : string, outputValue : Record<string, unknown>) : Promise<Tp.FormatObjects.FormattedObject[]> {
        const reply = await this._dlg.showNotification(program, appName, outputValue);
        return reply.messages.map((msg) => typeof msg === 'string' ? new FORMAT_TYPES.text({ type: 'text', text: msg }) : msg) as Tp.FormatObjects.FormattedObject[];
    }
}
