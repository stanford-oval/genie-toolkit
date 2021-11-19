// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
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
import { Runtime } from 'thingtalk';
import type * as stream from 'stream';
import AsyncQueue from 'consumer-queue';
import * as crypto from 'crypto';

import RateLimiter from '../util/rate_limiter';

import * as Protocol from '../sync/protocol';
import { ChannelStateBinder } from './channel_state_binder';

import type ExecWrapper from './exec_wrapper';
import type DeviceView from '../devices/device_view';

function extendParams(output : Record<string, unknown>, input : Record<string, unknown>) {
    for (const key in input) {
        if (Object.prototype.hasOwnProperty.call(output, key))
            continue;
        output[key] = input[key];
    }
}

type MonitorStream = stream.Readable & {
    destroy() : void;
    uniqueId ?: string;
    device ?: Tp.BaseDevice;
}

type SubscribeFunction = (params : Record<string, unknown>, state : ChannelStateBinder, hints : Runtime.CompiledQueryHints, env : ExecWrapper) => MonitorStream;
type MonitorEvent = Record<string, unknown> & { __timestamp : number };

export default class MonitorRunner {
    private _env : ExecWrapper;
    private _devices : DeviceView;
    private _channel : string;
    private _fn : string;
    private _params : Record<string, unknown>;
    private _hints : Runtime.CompiledQueryHints;
    private _stateId : string;
    private _rateLimiter : RateLimiter;
    private _streams : Map<Tp.BaseDevice, MonitorStream>;
    private _ended : Set<MonitorStream>;
    private _stopped : boolean;
    private _queue : AsyncQueue<IteratorResult<[string, MonitorEvent], void>>;
    private _dataListener : (this : MonitorStream, data : MonitorEvent) => void;
    private _endListener : (this : MonitorStream) => void;
    private _errorListener : (this : MonitorStream, error : Error) => void;

    constructor(env : ExecWrapper,
                devices : DeviceView,
                channel : string,
                params : Record<string, unknown>,
                hints : Runtime.CompiledQueryHints) {
        this._env = env;
        this._channel = channel;
        this._fn = 'subscribe_' + channel;
        this._params = params;
        this._hints = hints;
        this._stateId = this._makeStateUniqueId();

        // rate limit to 1 per second, with a burst of 300
        this._rateLimiter = new RateLimiter(300, 300 * 1000);

        const self = this;
        this._dataListener = function(data) {
            const from = this;
            self._onTriggerData(from, data);
        };
        this._endListener = function() {
            const from = this;
            self._onTriggerEnd(from);
        };
        this._errorListener = function(error) {
            const from = this;
            self._onTriggerError(from, error);
        };

        this._devices = devices;
        this._streams = new Map; // from device to the corresponding stream
        this._ended = new Set;
        this._stopped = false;
        this._queue = new AsyncQueue();
    }

    next() {
        return this._queue.pop();
    }

    private _onTriggerError(from : MonitorStream, error : Error) {
        this._env.reportError('Trigger ' + from.uniqueId + ' reported an error', error);
    }

    private _onTriggerData(from : MonitorStream, data : MonitorEvent) {
        if (this._stopped)
            return;
        if (!this._rateLimiter.hit())
            return;

        console.log('Handling incoming data on ' + from.uniqueId);

        const outputType = from.device!.kind + ':' + this._channel;
        if (data.__timestamp === undefined) {
            console.log('WARNING: missing timestamp on data from ' + from.uniqueId);
            const now = Date.now();
            data.__timestamp = now;
        }
        if (from.device!.uniqueId !== from.device!.kind)
            data.__device = new Tp.Value.Entity(from.device!.uniqueId!, from.device!.name);
        extendParams(data, this._params);
        this._queue.push({ done: false, value: [outputType, data] });
    }

    private _onTriggerEnd(from : MonitorStream) {
        console.log('Handling trigger end from ' + from.uniqueId);
        if (this._stopped)
            return;
        this._ended.add(from);
        if (this._ended.size === this._streams.size) {
            this._stopped = true;
            this._queue.push({ done: true, value: undefined });
        }
    }

    private _makeStateUniqueId() {
        const hash = crypto.createHash('sha256');
        hash.update(this._env.app.uniqueId);
        hash.update(':');
        hash.update(this._channel);
        hash.update(':');
        hash.update(Protocol.params.makeString(this._params));
        hash.update(':');
        hash.update(Protocol.params.makeString(this._hints as Record<string, unknown>));
        return hash.digest('base64');
    }

    private _onDeviceAdded(device : Tp.BaseDevice) {
        const uniqueId = `monitor:${device.uniqueId}:${this._stateId}`;

        Promise.resolve().then(() => {
            const state = new ChannelStateBinder(this._env.engine.db, uniqueId);
            return state.open().then(() => {
                if (this._stopped)
                    return;

                const stream = (device as unknown as Record<string, SubscribeFunction>)[this._fn](this._params, state, this._hints, this._env);
                this._streams.set(device, stream);

                stream.uniqueId = uniqueId; // for debugging only
                stream.device = device;

                stream.on('error', this._errorListener);
                stream.on('end', this._endListener);
                stream.on('data', this._dataListener);
            });
        }).catch((e) => {
            this._env.reportError('Failed to initialize trigger ' + uniqueId, e);
        });
    }

    private _onDeviceRemoved(device : Tp.BaseDevice) {
        const stream = this._streams.get(device);
        if (!stream)
            return;

        this._streams.delete(device);
        stream.destroy();
    }

    end() {
        if (this._stopped)
            return;
        this._stopped = true;
        this._queue.push({ done: true, value: undefined });
    }

    stop() {
        this._stopped = true;
        this._devices.stop();

        for (const stream of this._streams.values())
            stream.destroy();
    }

    start() {
        this._devices.on('object-added', this._onDeviceAdded.bind(this));
        this._devices.on('object-removed', this._onDeviceRemoved.bind(this));
        this._devices.start();
    }
}
