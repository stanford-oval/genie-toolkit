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
// Author: Jim Deng

import * as events from 'events';

import AppDatabase from './apps/database';

const DEFAULT_IDLE_TIMEOUT = 600000; // 10 minutes
const DEFAULT_QUIESCE_TIMEOUT = 30000; // 30 seconds

export enum ActivityMonitorStatus {
    Starting = "starting",
    Running = "running",
    Idle = "idle",
    Stopping = 'stopping'
}

/**
 * Monitors engine activity and emits an 'idle' event when engine is inactive.
 * There are two monitoring timers. The first timer starts when there is no apps
 * and resets on any activity.  The second timer starts after the first timer
 * expires and immdiately broadcasts a ping message to all conversations. Any
 * activity from ping resoponse or other events will reset the timers.
 * The reason for the second timer is to avoid bounce from an idle but connected
 * client session, which reconnects when the connection is closed.
 */
export class ActivityMonitor extends events.EventEmitter {
    private _name : string;  // display name for logging
    private _status : ActivityMonitorStatus;
    private _appdb : AppDatabase;
    private _lastUpdate : number;
    private _idleTimeout : NodeJS.Timeout|null;
    private _idleTimeoutMillis : number;
    private _quiesceTimeout : NodeJS.Timeout|null;
    private _quiesceTimeoutMillis : number;
    private _appAddedListener : () => void;
    private _appRemovedListener : () => void;

    constructor(appdb : AppDatabase, options : {
        idleTimeoutMillis ?: number;
        quiesceTimeoutMillis ?: number;
    } = {}) {
        super();
        this._name = "Activity monitor";
        this._status = ActivityMonitorStatus.Starting;
        this._appdb = appdb;
        this._lastUpdate = 0;
        this._idleTimeout = null;
        this._idleTimeoutMillis = options.idleTimeoutMillis || DEFAULT_IDLE_TIMEOUT;
        this._quiesceTimeout = null;
        this._quiesceTimeoutMillis = options.quiesceTimeoutMillis || DEFAULT_QUIESCE_TIMEOUT;
        this._appAddedListener = this.updateActivity.bind(this);
        this._appRemovedListener = this.updateActivity.bind(this);
    }

    set name(name : string) {
        this._name = name;
    }

    get status() {
        return this._status;
    }

    async start() {
        console.log(`${this._name} started`);
        this._appdb.on('app-added', this._appAddedListener);
        this._appdb.on('app-removed', this._appRemovedListener);
        this._status = ActivityMonitorStatus.Running;
        this.updateActivity();
    }

    updateActivity() {
        if (this._status === ActivityMonitorStatus.Starting || this._status === ActivityMonitorStatus.Stopping)
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

    private _maybeStartActivityTimeout() {
        if (!this._appdb.isEmpty())
            return;
        const idleTimeout = Math.max(this._idleTimeoutMillis - (Date.now() - this._lastUpdate), 0);
        console.log(`${this._name} started idle timer ${idleTimeout} ms`);
        this._idleTimeout = setTimeout(() => {
            this._idleTimeout = null;
            const msSinceLastUpdate = Date.now() - this._lastUpdate;
            if (msSinceLastUpdate >= this._idleTimeoutMillis)
                this._startQuiesce();
            else
                this._maybeStartActivityTimeout();
        }, idleTimeout);
    }

    private _startQuiesce() {
        console.log(`${this._name} started quiesce timer ${this._quiesceTimeoutMillis} ms`);
        this._quiesceTimeout = setTimeout(() => {
            this._quiesceTimeout = null;
            this._status = ActivityMonitorStatus.Idle;
            this.emit("idle");
            console.log(`${this._name} emitted idle event`);
        }, this._quiesceTimeoutMillis);
        this.emit('ping');
    }

    async stop() {
        console.log(`${this._name} stopped`);
        this._status = ActivityMonitorStatus.Stopping;
        if (this._idleTimeout !== null)
            clearTimeout(this._idleTimeout);
        if (this._quiesceTimeout !== null)
            clearTimeout(this._quiesceTimeout);
        this._appdb.removeListener('app-added', this._appAddedListener);
        this._appdb.removeListener('app-removed', this._appRemovedListener);
    }
}
