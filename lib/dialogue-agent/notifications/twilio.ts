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

interface TwilioConfig {
    accountSid : string;
    authToken : string;
    from : string;
    fromByLocale ?: Record<string, string>;
}

export default class TwilioNotificationBackend implements Tp.Capabilities.NotificationBackend {
    private _platform : Tp.BasePlatform;
    private _client : twilio.Twilio;
    private _from : string;
    name = 'SMS';
    uniqueId = 'twilio';

    constructor(engine : Engine, config : TwilioConfig) {
        this._platform = engine.platform;
        this._client = new twilio.Twilio(config.accountSid, config.authToken);
        this._from = config.fromByLocale ? (config.fromByLocale[this._platform.locale] || config.from)
            : config.from;
    }

    get requiredSettings() {
        return { to: '$context.self.phone_number' };
    }

    async notify(data : {
        appId : string;
        icon : string|null;
        raw : Record<string, unknown>;
        type : string;
        formatted : Tp.FormatObjects.FormattedObject[]
    }, config ?: Record<string, string>) {
        let to;
        if (config) {
            to = config.to;
        } else {
            const profile = this._platform.getProfile();
            if (!profile.phone || !profile.phone_verified)
                return;
            to = profile.phone;
        }

        let body = data.formatted.map((x) => x.toLocaleString(this._platform.locale)).join('\n');
        body += ' To stop these messages, say STOP.';

        try {
            await this._client.messages.create({
                to, from: this._from, body
            });
        } catch(e) {
            // can happen e.g. if unsubscribed
            console.error(`Failed to send SMS to ${to}: ${e.message}`);
        }
    }

    async notifyError(data : {
        appId : string;
        icon : string|null;
        error : Error
    }) {
        // do nothing, and swallow the error...
    }
}
