// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
"use strict";

const AsyncQueue = require('consumer-queue');

const RateLimiter = require('../util/rate_limiter');

const Protocol = require('../tiers/protocol');
const { ChannelStateBinder } = require('../db/channel');

function extendParams(output, input) {
    for (let key in input) {
         if (Object.prototype.hasOwnProperty.call(output, key))
             continue;
         output[key] = input[key];
    }
}

// TODO rename file
module.exports = class MonitorRunner {
    constructor(env, devices, channel, params, hints) {
        this._env = env;
        this._channel = channel;
        this._fn = 'subscribe_' + channel;
        this._params = params;
        this._hints = hints;

        // rate limit to 1 per second, with a burst of 300
        this._rateLimiter = new RateLimiter(300, 300 * 1000);

        var self = this;
        this._dataListener = function(data) {
            var from = this;
            self._onTriggerData(from, data);
        };
        this._endListener = function() {
            var from = this;
            self._onTriggerEnd(from);
        };
        this._errorListener = function(error) {
            var from = this;
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

    _onTriggerError(from, error) {
        this._env.reportError('Trigger ' + from.uniqueId + ' reported an error', error);
    }

    _onTriggerData(from, data) {
        if (this._stopped)
            return;
        if (!this._rateLimiter.hit())
            return;

        console.log('Handling incoming data on ' + from.uniqueId);

        let outputType = from.device.kind + ':' + this._channel;
        if (data.__timestamp === undefined) {
            console.log('WARNING: missing timestamp on data from ' + from.uniqueId);
            let now = Date.now();
            data.__timestamp = now;
        }
        extendParams(data, this._params);
        this._queue.push({ done: false, value: [outputType, data] });
    }

    _onTriggerEnd(from) {
        console.log('Handling trigger end from ' + from.uniqueId);
        if (this._stopped)
            return;
        this._ended.add(from);
        if (this._ended.size === this._streams.size) {
            this._stopped = true;
            this._queue.push({ done: true });
        }
    }

    _onDeviceAdded(device) {
        const uniqueId = device.uniqueId + ':' + this._channel + ':' + Protocol.params.makeString(this._params);

        Promise.resolve().then(() => {
            const state = new ChannelStateBinder(this._env.engine.platform);
            // TODO deduplicate subscriptions globally
            // (this needs to be done at a different level because we need to
            // do global common subexpression elimination to save history)

            state.init(uniqueId);

            return state.open().then(() => {
                if (this._stopped)
                    return;

                let stream = device[this._fn](this._params, state, this._hints);
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

    _onDeviceRemoved(device) {
        let stream = this._streams.get(device);
        if (!stream)
            return;

        this._streams.delete(device);
        stream.destroy();
    }

    end() {
        if (this._stopped)
            return;
        this._stopped = true;
        this._queue.push({ done: true });
    }

    stop() {
        this._stopped = true;
        this._devices.stop();

        for (let stream of this._streams.values())
            stream.destroy();
    }

    start() {
        this._devices.on('object-added', this._onDeviceAdded.bind(this));
        this._devices.on('object-removed', this._onDeviceRemoved.bind(this));
        this._devices.start();
    }
};
