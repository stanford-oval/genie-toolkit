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
import * as twilio from 'twilio';

import type Engine from '../../engine';
import { FormattedObject } from './formatter';

interface TwilioConfig {
    accountSid : string;
    authToken : string;
    from : string;
}

export default class TwilioNotificationBackend {
    private _platform : Tp.BasePlatform;
    private _client : twilio.Twilio;
    private _from : string;
    name = 'SMS';
    uniqueId = 'twilio';

    constructor(engine : Engine, config : TwilioConfig) {
        this._platform = engine.platform;
        this._client = new twilio.Twilio(config.accountSid, config.authToken);
        this._from = config.from;
    }

    get requiredSettings() {
        return ['$context.self.phone_number'];
    }

    async notify(data : {
        appId : string;
        icon : string|null;
        raw : Record<string, unknown>;
        type : string;
        formatted : FormattedObject[]
    }) {
        const prefs = this._platform.getSharedPreferences();
        const to = prefs.get('context-$context.self.phone_number') as string;

        await this._client.messages.create({
            to, from: this._from,
            body: data.formatted.map((x) => x.toLocaleString(this._platform.locale)).join('\n')
        });
    }

    async notifyError(data : {
        appId : string;
        icon : string|null;
        error : Error
    }) {
        // do nothing, and swallow the error...
    }
}
