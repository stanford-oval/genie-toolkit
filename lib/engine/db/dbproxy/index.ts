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

import type * as DB from '..';

import LocalTable from './local_table';
import SyncTable from './sync_table';

export interface DatabaseProxyConfig {
    baseUrl : string
    accessToken ?: string
}

const FIELD_NAMES = {
    app: ['code', 'state', 'name', 'description'] as const,
    device: ['state'] as const,
    channel: ['value'] as const
};

export class DatabaseProxy implements DB.AbstractDatabase {
    _config : DatabaseProxyConfig

    constructor(public config : DatabaseProxyConfig) {
        this._config = config;
    }

    ensureSchema() {
        // database initialization is done in the cloud
        return Promise.resolve();
    }

    getLocalTable<T extends keyof DB.LocalTables>(name : T) : LocalTable<DB.LocalTables[T]> {
        return new LocalTable(name, this._config.baseUrl, this._config.accessToken);
    }

    getSyncTable<T extends keyof DB.SyncTables>(name : T) : SyncTable<DB.SyncTables[T]> {
        return new SyncTable(name, this._config.baseUrl, this._config.accessToken, FIELD_NAMES[name] as any);
    }
}
