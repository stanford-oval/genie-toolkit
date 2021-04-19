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

import { FormattedObject } from './formatter';

import TwilioNotificationBackend from './twilio';
import EmailNotificationBackend from './email';

export interface NotificationDelegate {
    notify(data : {
        appId : string;
        icon : string|null;
        raw : Record<string, unknown>;
        type : string;
        formatted : FormattedObject[]
    }) : Promise<void>;

    notifyError(data : {
        appId : string;
        icon : string|null;
        error : Error
    }) : Promise<void>;
}

export interface NotificationBackend {
    readonly name : string;
    readonly uniqueId : string;
    readonly requiredSettings : Record<string, string>;

    notify(data : {
        appId : string;
        icon : string|null;
        raw : Record<string, unknown>;
        type : string;
        formatted : FormattedObject[]
    }, config ?: Record<string, string>) : Promise<void>;

    notifyError(data : {
        appId : string;
        icon : string|null;
        error : Error
    }, config ?: Record<string, string>) : Promise<void>;
}

export const StaticNotificationBackends = {
    'twilio': TwilioNotificationBackend,
    'email': EmailNotificationBackend,
};

export type NotificationConfig = {
    [T in keyof typeof StaticNotificationBackends] ?: ConstructorParameters<(typeof StaticNotificationBackends)[T]>[1]
}

/**
 * Helper class to adapt a Thingpedia device into a notification backend.
 */
export class ThingpediaNotificationBackend implements NotificationBackend {
    private _iface : NotificationDelegate;
    name : string;
    uniqueId : string;

    constructor(device : Tp.BaseDevice) {
        this.name = device.name;
        this.uniqueId = 'thingpedia/' + device.uniqueId;
        this._iface = device.queryInterface('notifications') as NotificationDelegate;
    }

    get requiredSettings() {
        return {};
    }

    notify(data : {
        appId : string;
        icon : string|null;
        raw : Record<string, unknown>;
        type : string;
        formatted : FormattedObject[]
    }) {
        return this._iface.notify(data);
    }

    notifyError(data : {
        appId : string;
        icon : string|null;
        error : Error
    }) {
        return this._iface.notifyError(data);
    }
}
