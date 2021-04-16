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
import * as nodemailer from 'nodemailer';

import type Engine from '../../engine';
import { FormattedObject } from './formatter';

interface EmailConfig {
    service : string;
    from : string;
    auth : {
        user : string;
        pass : string;
    };
}

export default class EmailNotificationBackend {
    private _platform : Tp.BasePlatform;
    private _client : nodemailer.Transporter;
    private _from : string;
    name = 'E-mail';
    uniqueId = 'email';

    constructor(engine : Engine, config : EmailConfig) {
        this._platform = engine.platform;
        this._client = nodemailer.createTransport(config);
        this._from = config.from;
    }

    get requiredSettings() {
        return ['$context.self.email_address'];
    }

    async notify(data : {
        appId : string;
        icon : string|null;
        raw : Record<string, unknown>;
        type : string;
        formatted : FormattedObject[]
    }) {
        const profile = this._platform.getProfile();
        if (!profile.email || !profile.email_verified)
            return;

        await this._client.sendMail({
            to: profile.email,
            from: this._from,
            subject: "Notification from Genie",
            text: data.formatted.map((x) => x.toLocaleString(this._platform.locale)).join('\n')
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
