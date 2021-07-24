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
import interpolate from 'string-interp';

import type Engine from '../../engine';

interface EmailConfig {
    service : string;
    from : string;
    auth : {
        user : string;
        pass : string;
    };
    unsubscribeURL : string;
}

function htmlEscape(x : string|undefined) {
    if (!x)
        return '';
    return x.replace(/'"&<>/g, (char : string) => {
        switch (char) {
        case "'":
            return '&apos';
        case '"':
            return '&quot;';
        case '&':
            return '&amp;';
        case '<':
            return '&lt;';
        case '>':
            return '&gt;';
        default:
            return char;
        }
    });
}

export default class EmailNotificationBackend implements Tp.Capabilities.NotificationBackend {
    private _platform : Tp.BasePlatform;
    private _client : nodemailer.Transporter;
    private _from : string;
    private _unsubURL : string;
    name = 'E-mail';
    uniqueId = 'email';

    constructor(engine : Engine, config : EmailConfig) {
        this._platform = engine.platform;
        this._client = nodemailer.createTransport(config);
        this._from = config.from;
        this._unsubURL = config.unsubscribeURL;
    }

    get requiredSettings() {
        return { to: '$context.self.email_address' };
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
            if (!profile.email || !profile.email_verified)
                return;
            to = profile.email;
        }

        const unsubscribeURL = interpolate(this._unsubURL, {
            email: new Buffer(to).toString('base64')
        }, {
            locale: this._platform.locale,
            timezone: this._platform.timezone
        })!;

        let text = data.formatted.map((x) => x.toLocaleString(this._platform.locale)).join('\n');
        text += `
----
You are receiving this email because you subscribed to notifications
from Genie. To stop, open the following link:
${unsubscribeURL}
`;

        let html = data.formatted.map((x) => {
            if (x.type === 'text')
                return `<p>${htmlEscape(x.text)}</p>`;
            if (x.type === 'picture')
                return `<img style="display:block;max-width:80%;max-height:400px;" src="${htmlEscape(x.url)}" alt="${htmlEscape(x.alt)}" />`;
            if (x.type === 'rdl') {
                return `<h4><a href="${htmlEscape(x.webCallback)}">${htmlEscape(x.displayTitle)}</a></h4>`
                    + (x.displayText ? `<p>${htmlEscape(x.displayText)}</p>` : '');
            }
            return `<p>${htmlEscape(x.toLocaleString(this._platform.locale))}</p>`;
        }).join('\n');
        html += `
<hr/>
<p>You are receiving this email because you subscribed to notifications
from Genie. To stop, you can <a href="${htmlEscape(unsubscribeURL)}">unsubscribe</a>.</p>`;

        await this._client.sendMail({
            to, from: this._from,
            subject: "Notification from Genie",
            text, html
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
