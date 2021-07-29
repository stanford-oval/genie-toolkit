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

import * as events from 'events';
import AppDatabase from './apps/database';
import AssistantDispatcher from '../dialogue-agent/assistant_dispatcher';

const DEFAULT_IDLE_TIMEOUT = 600000; // 10 minutes
const DEFAULT_QUIESCE_TIMEOUT = 30000; // 30 seconds

export interface ActivityMonitorOptions  { 
        idleTimeoutMillis : number;
        quiesceTimeoutMillis : number;
}

/**
 * Monitors engine activity and emits an 'idle' event when engine is
 * inactive.
 */
export class ActivityMonitor extends events.EventEmitter {
    private _running : boolean;
    private _appdb : AppDatabase;
    private _assistant : AssistantDispatcher;
    private _lastUpdate : number;
    private _idleTimeout : NodeJS.Timeout|null;
    private _idleTimeoutMillis : number;
    private _quiesceTimeout : NodeJS.Timeout|null;
    private _quiesceTimeoutMillis : number;

    constructor(appdb : AppDatabase, assistant : AssistantDispatcher, options : ActivityMonitorOptions) {
        super();
        this._running = false;
        this._appdb = appdb;
        this._assistant = assistant;
        this._lastUpdate = 0;
        this._idleTimeout = null;
        this._idleTimeoutMillis = options.idleTimeoutMillis || DEFAULT_IDLE_TIMEOUT;
        this._quiesceTimeout = null;
        this._quiesceTimeoutMillis = options.quiesceTimeoutMillis || DEFAULT_QUIESCE_TIMEOUT;
    }

    start() {
        this._appdb.on('app-added', this.updateActivity.bind(this));
        this._appdb.on('app-removed', this.updateActivity.bind(this));
        this._running = true;
        console.log('Activity monitor started');
        this.updateActivity();
    }

    updateActivity() {
        if (!this._running)
            return;
        this._lastUpdate = Date.now();
        if (this._idleTimeout !== null)
            return;
        if (this._quiesceTimeout !== null) {
            clearTimeout(this._quiesceTimeout);
            this._quiesceTimeout = null;
        }
        this._maybeStartActivityTimeout();
    }

    _maybeStartActivityTimeout() {
        if (this._appdb.getAllApps().length > 0) 
            return;
        const idleTimeout = Math.max(this._idleTimeoutMillis - (Date.now() - this._lastUpdate), 0);
        console.log(`Activity monitor starts idle timer ${idleTimeout} ms`);
        this._idleTimeout = setTimeout(() => {
            this._idleTimeout = null;
            const msSinceLastUpdate = Date.now() - this._lastUpdate;
            if (msSinceLastUpdate >= this._idleTimeoutMillis)
                this._startQuiesce();
            else
                this._maybeStartActivityTimeout();
        }, idleTimeout);
    }

    _startQuiesce() {
        console.log(`Activity monitor starts quiesce timer ${this._quiesceTimeoutMillis} ms`);
        this._quiesceTimeout = setTimeout(() => {
            this._quiesceTimeout = null;
            console.log('Activity monitor emits idle event');
            this.emit("idle");
        }, this._quiesceTimeoutMillis);
        for (const [_, conversation] of this._assistant.getConversations())
            conversation.sendPing();
    }

    stop() {
        this._running = false;
        if (this._idleTimeout !== null) 
            clearTimeout(this._idleTimeout);
        if (this._quiesceTimeout !== null)
            clearTimeout(this._quiesceTimeout);
        console.log('Activity monitor stopped');
    }
}