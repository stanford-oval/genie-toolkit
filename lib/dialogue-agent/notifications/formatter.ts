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

import * as ThingTalk from 'thingtalk';

import Engine from '../../engine';
import * as I18n from '../../i18n';

import StatementExecutor from '../statement_executor';
import DialoguePolicy from '../dialogue_policy';

import CardFormatter, { FormattedObject } from '../card-output/card-formatter';
import { FORMAT_TYPES } from '../card-output/format_objects';
export { FormattedObject };

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
    private _engine : Engine;
    private _cardFormatter : CardFormatter;
    private _policy : DialoguePolicy;
    private _executor : StatementExecutor;
    private _langPack : I18n.LanguagePack;

    /**
     * Construct a new formatter for a given Genie engine.
     */
    constructor(engine : Engine) {
        this._engine = engine;

        this._cardFormatter = new CardFormatter(engine.platform.locale, engine.platform.timezone, engine.schemas);
        this._langPack = I18n.get(engine.platform.locale);

        this._executor = new StatementExecutor(engine);
        this._policy = new DialoguePolicy({
            thingpedia: engine.thingpedia,
            schemas: engine.schemas,
            locale: engine.platform.locale,
            timezone: engine.platform.timezone,
            rng: Math.random,
            debug: 0
        });
    }

    async formatNotification(appName : string|null, program : ThingTalk.Ast.Program, outputType : string, outputValue : Record<string, unknown>) : Promise<FormattedObject[]> {
        const mappedResult = await this._executor.mapResult(outputType, outputValue);

        const dialogueState = await this._policy.getNotificationState(appName, program, mappedResult);

        const policyResult = await this._policy.chooseAction(dialogueState);
        if (!policyResult)
            throw new Error(`Unexpected invalid state from agent during notification`);

        const [, , utterance, entities,] = policyResult;
        const postprocessed = this._langPack.postprocessNLG(utterance, entities, {
            timezone: this._engine.platform.timezone,
            getPreferredUnit: (type : string) => {
                const pref = this._engine.platform.getSharedPreferences();
                return pref.get('preferred-' + type) as string|undefined;
            }
        });

        const output : FormattedObject[] = [
            new FORMAT_TYPES.text({ type: 'text', text: postprocessed })
        ];
        const formatted = await this._cardFormatter.formatForType(outputType, outputValue);
        for (const card of formatted)
            output.push(card);

        return output;
    }
}
