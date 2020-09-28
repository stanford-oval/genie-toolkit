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

import assert from 'assert';
import * as ThingTalk from 'thingtalk';
const ExecEnvironment = ThingTalk.ExecEnvironment;
import TriggerRunner from './trigger_runner';

import { Timer, AtTimer } from './timers';
import DeviceView from '../devices/device_view';

function extendParams(output, input) {
    for (let key in input) {
        if (Object.prototype.hasOwnProperty.call(output, key))
            continue;
        output[key] = input[key];
    }
}

/**
 * Wrap a ThingTalk statement and provide access to the Engine.
 *
 * This is an implementation of {@link external:thingtalk.ExecEnvironment}
 * suitable for running with the Almond engine.
 *
 * @extends external:thingtalk.ExecEnvironment
 * @package
 */
export default class ExecWrapper extends ExecEnvironment {
    constructor(engine, app, output) {
        super(engine.platform.locale, engine.platform.timezone, engine.schemas,
            engine.platform.getCapability('gettext'));
        this.engine = engine;
        this.app = app;
        this._programId = new ThingTalk.Entity(this.app.uniqueId, null);
        this._outputDelegate = output;

        this._trigger = null;

        this._execCache = [];
        this._hooks = [];
    }

    setOutput(delegate) {
        this._outputDelegate = delegate;
    }

    get program_id() {
        return this._programId;
    }

    endProgram() {
        if (this._trigger)
            this._trigger.end();
        // otherwise just wait for the query/action to end
    }

    stopTrigger() {
        if (this._trigger)
            this._trigger.stop();
    }

    _wrapClearCache(asyncIterable) {
        const self = this;
        return {
            async next() {
                const value = await asyncIterable.next();
                self.clearGetCache();
                return value;
            }
        };
    }

    loadContext(info, into) {
        return this.engine.platform.loadContext(info);
    }

    invokeTimer(base, interval, frequency) {
        this._trigger = new Timer(base, interval, frequency);
        this._trigger.start();
        return this._wrapClearCache(this._trigger);
    }

    invokeAtTimer(time, expiration_date) {
        this._trigger = new AtTimer(time, expiration_date);
        this._trigger.start();
        return this._wrapClearCache(this._trigger);
    }

    invokeMonitor(kind, attrs, fname, params, hints) {
        this._trigger = new TriggerRunner(this, new DeviceView(this.engine.devices, kind, attrs), fname, params, hints);
        this._trigger.start();
        return this._wrapClearCache(this._trigger);
    }

    _findInCache(kindKey, fnameKey, params) {
        for (let cached of this._execCache) {
            let [kind, fname, cachedparams, result] = cached;
            if (kind === kindKey && fname === fnameKey &&
                ThingTalk.Builtin.equality(cachedparams, params))
                return result;
        }
        return null;
    }
    clearGetCache() {
        this._execCache = [];
    }

    _getDevices(kind, attrs) {
        const deviceView = new DeviceView(this.engine.devices, kind, attrs, false);
        deviceView.start();
        return deviceView.values();
    }

    addExitProcedureHook(hook) {
        this._hooks.push(hook);
    }
    async exitProcedure() {
        await super.exitProcedure();
        for (const hook of this._hooks)
            await hook();
        this._hooks = [];
    }

    invokeQuery(kind, attrs, fname, params, hints) {

        const cached = this._findInCache(kind, fname, params, hints);
        if (cached)
            return Promise.resolve(cached);

        const devices = this._getDevices(kind, attrs);
        const js_function_name = 'get_' + fname;

        const list = Promise.all(devices.map(async (d) => {
            return d[js_function_name](params, hints, this);
        })).then((results) => {
            // TODO make this streaming

            let list = [];
            results.forEach((result, i) => {
                let device = devices[i];
                let outputType = device.kind + ':' + fname;
                for (let element of result) {
                    extendParams(element, params);
                    list.push([outputType, element]);
                }
            });
            return list;
        });
        // cache now, rather than when the query completes, because ThingTalk might
        // invoke multiple queries in parallel
        this._execCache.push([kind, fname, params, list]);
        return list;
    }

    async invokeDBQuery(kind, attrs, query) {
        assert(attrs.id);
        const device = this.engine.devices.getDevice(attrs.id);
        if (!device)
            return [];

        assert(device.hasKind(kind));

        const results = await device.query(query, this);

        function recursivelyComputeOutputType(table) {
            if (table.isInvocation)
                return device.kind + ':' + table.invocation.channel;
            if (table.isJoin)
                return recursivelyComputeOutputType(table.lhs) + '+' + recursivelyComputeOutputType(table.rhs);
            if (table.isAggregation)
                return table.operator + '(' + recursivelyComputeOutputType(table.table) + ')';
            if (table.table) // projection, index, slice, history, sequence, compute
                return recursivelyComputeOutputType(table.table);

            throw new TypeError('Invalid query table ' + table);
        }
        const outputType = recursivelyComputeOutputType(query.rules[0].table);

        let list = [];
        for (let result of results)
            list.push([outputType, result]);
        return list;
    }

    readState(stateId) {
        return this.app.readState(stateId);
    }
    writeState(stateId, state) {
        return this.app.writeState(stateId, state);
    }

    async invokeAction(kind, attrs, fname, params) {
        const devices = this._getDevices(kind, attrs);
        const js_function_name = 'do_' + fname;
        return Promise.all(devices.map(async (d) => {
            const outputType = d.kind + ':action/' + fname;

            let result = await d[js_function_name](params, this);
            if (typeof result === 'object') {
                extendParams(result, params);
            } else if (typeof result !== 'undefined') {
                console.error(`${outputType} returned a value that is not an object and not undefined; this is deprecated and might break`);
                result = undefined;
            }
            return [outputType, result];
        }));
    }

    sendEndOfFlow(principal, flow) {
        return this.engine.remote.sendEndOfFlow(principal, this.program_id, flow);
    }

    get icon() {
        return this.app.icon;
    }

    reportError(message, error) {
        // cancellation errors should bubble up
        if (error.code === 'ECANCELLED')
            throw error;

        console.error(message, error);
        this.app.error = error;
        return this._outputDelegate.notifyError(error);
    }

    output(outputType, outputValues) {
        return this._outputDelegate.output(outputType, outputValues);
    }
}
