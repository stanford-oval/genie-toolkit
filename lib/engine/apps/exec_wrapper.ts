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

import assert from 'assert';

import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';
import { Ast, ExecEnvironment } from 'thingtalk';
import TriggerRunner from './trigger_runner';

import { Timer, AtTimer } from './timers';
import DeviceView from '../devices/device_view';

import type AppExecutor from './app_executor';
import type Engine from '../index';

function extendParams(output : Record<string, unknown>,
                      input : Record<string, unknown>) {
    for (const key in input) {
        if (Object.prototype.hasOwnProperty.call(output, key))
            continue;
        output[key] = input[key];
    }
}

interface OutputDelegate {
    done() : void;
    output(outputType : string, outputValue : Record<string, unknown>) : void;
    notifyError(error : Error) : void;
}

type CompiledFilterHint = [string, string, unknown];
export interface CompiledQueryHints {
    filter ?: CompiledFilterHint[];
    sort ?: [string, 'asc' | 'desc'];
    projection ?: string[];
    limit ?: number;
}

type MaybePromise<T> = T|Promise<T>;
type ActionFunction = (params : Record<string, unknown>, env : ExecWrapper) => MaybePromise<unknown>;

type QueryFunctionResult = Iterable<Record<string, unknown>>|AsyncIterable<Record<string, unknown>>;
type QueryFunction = (params : Record<string, unknown>, hints : CompiledQueryHints, env : ExecWrapper) => MaybePromise<QueryFunctionResult>;

interface TriggerLike {
    end() : void;
    stop() : void;
}

/**
 * Wrap a ThingTalk statement and provide access to the Engine.
 *
 * This is an implementation of {@link external:thingtalk.ExecEnvironment}
 * suitable for running with the Almond engine.
 *
 * @package
 */
export default class ExecWrapper extends ExecEnvironment {
    engine : Engine;
    app : AppExecutor;

    private _programId : ThingTalk.Builtin.Entity;
    private _outputDelegate : OutputDelegate;
    private _trigger : TriggerLike|null;

    private _execCache : Array<[string, string, Record<string, unknown>, Array<Promise<QueryFunctionResult>>]>;
    private _hooks : Array<() => void|Promise<void>>;

    constructor(engine : Engine, app : AppExecutor, output : OutputDelegate) {
        super(engine.platform.locale, engine.platform.timezone, engine.schemas,
            engine.platform.getCapability('gettext')!);
        this.engine = engine;
        this.app = app;
        this._programId = new ThingTalk.Builtin.Entity(this.app.uniqueId!, null);
        this._outputDelegate = output;

        this._trigger = null;

        this._execCache = [];
        this._hooks = [];
    }

    setOutput(delegate : OutputDelegate) {
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

    private _wrapClearCache<T>(asyncIterable : AsyncIterator<T>) : AsyncIterator<T> {
        const self = this;
        return {
            async next() {
                const value = await asyncIterable.next();
                self.clearGetCache();
                return value;
            }
        };
    }

    loadContext() : never {
        throw new Error('$context is not implemented');
        //return this.engine.platform.loadContext(info);
    }

    invokeTimer(base : Date, interval : number, frequency : number) : AsyncIterator<{ __timestamp : number }> {
        const trigger = new Timer(base, interval, frequency);
        this._trigger = trigger;
        trigger.start();
        return this._wrapClearCache(trigger);
    }

    invokeAtTimer(time : ThingTalk.Builtin.Time[], expiration_date : Date|undefined) : AsyncIterator<{ __timestamp : number }> {
        const trigger = new AtTimer(time, expiration_date);
        this._trigger = trigger;
        trigger.start();
        return this._wrapClearCache(trigger);
    }

    invokeMonitor(kind : string,
                  attrs : Record<string, string>,
                  fname : string,
                  params : Record<string, unknown>,
                  hints : CompiledQueryHints) : AsyncIterator<[string, Record<string, unknown> & { __timestamp : number }]> {
        const trigger = new TriggerRunner(this, new DeviceView(this.engine.devices, kind, attrs), fname, params, hints);
        this._trigger = trigger;
        trigger.start();
        return this._wrapClearCache(trigger);
    }

    private _findInCache(kindKey : string, fnameKey : string, params : Record<string, unknown>) : Array<Promise<QueryFunctionResult>>|undefined {
        for (const cached of this._execCache) {
            const [kind, fname, cachedparams, result] = cached;
            if (kind === kindKey && fname === fnameKey &&
                ThingTalk.Builtin.equality(cachedparams, params))
                return result;
        }
        return undefined;
    }
    clearGetCache() {
        this._execCache = [];
    }

    private _getDevices(kind : string, attrs : Record<string, string>) : Tp.BaseDevice[] {
        const deviceView = new DeviceView(this.engine.devices, kind, attrs, false);
        deviceView.start();
        return deviceView.values();
    }

    addExitProcedureHook(hook : () => void|Promise<void>) {
        this._hooks.push(hook);
    }
    async exitProcedure(procid : number, procname : string) {
        await super.exitProcedure(procid, procname);
        for (const hook of this._hooks)
            await hook();
        this._hooks = [];
    }

    async *invokeQuery(kind : string,
                       attrs : Record<string, string>,
                       fname : string,
                       params : Record<string, unknown>,
                       hints : CompiledQueryHints) : AsyncIterable<[string, Record<string, unknown>]> {
        const devices = this._getDevices(kind, attrs);

        let promises : Array<Promise<QueryFunctionResult>>;
        const cached = this._findInCache(kind, fname, params);
        if (cached) {
            promises = cached;
        } else {
            const js_function_name = 'get_' + fname;

            promises = devices.map(async (d) => {
                return (d as unknown as Record<string, QueryFunction>)[js_function_name](params, hints, this);
            });
            // cache now, rather than when the query completes, because ThingTalk might
            // invoke multiple queries in parallel
            this._execCache.push([kind, fname, params, promises]);
        }

        for (let i = 0; i < promises.length; i++) {
            const list = await promises[i];

            const device = devices[i];
            const outputType = device.kind + ':' + fname;
            for await (const element of list) {
                extendParams(element, params);
                yield [outputType, element];
            }
        }
    }

    async *invokeDBQuery(kind : string, attrs : Record<string, string>, query : Ast.Program) : AsyncIterable<[string, Record<string, unknown>]> {
        assert(attrs.id);
        const device = this.engine.devices.getDevice(attrs.id);
        if (!device)
            return;

        assert(device.hasKind(kind));

        const results = await device.query(query, this);

        function recursivelyComputeOutputType(table : Ast.Table) : string {
            if (table instanceof Ast.InvocationTable)
                return device.kind + ':' + table.invocation.channel;
            if (table instanceof Ast.JoinTable)
                return recursivelyComputeOutputType(table.lhs) + '+' + recursivelyComputeOutputType(table.rhs);
            if (table instanceof Ast.AggregationTable)
                return table.operator + '(' + recursivelyComputeOutputType(table.table) + ')';
            if ('table' in table) // projection, index, slice, history, sequence, compute
                return recursivelyComputeOutputType((table as { table : Ast.Table }).table);

            throw new TypeError('Invalid query table ' + table);
        }
        const command = query.rules[0];
        assert(command instanceof Ast.Command);
        const outputType = recursivelyComputeOutputType(command.table!);

        for (const result of results)
            yield [outputType, result];
    }

    readState(stateId : number) {
        return this.app.readState(stateId);
    }
    writeState(stateId : number, state : unknown) {
        return this.app.writeState(stateId, state);
    }

    async *invokeAction(kind : string,
                        attrs : Record<string, string>,
                        fname : string,
                        params : Record<string, unknown>) : AsyncIterable<[string, Record<string, unknown>]> {
        const devices = this._getDevices(kind, attrs);
        const js_function_name = 'do_' + fname;

        for (const d of devices) {
            const outputType = d.kind + ':action/' + fname;

            let result = await (d as unknown as Record<string, ActionFunction>)[js_function_name](params, this);
            if (typeof result === 'object' && result !== null) {
                extendParams(result as Record<string, unknown>, params);
            } else if (typeof result !== 'undefined') {
                console.error(`${outputType} returned a value that is not an object and not undefined; this is deprecated and might break`);
                result = undefined;
            }

            if (result)
                yield [outputType, result as Record<string, unknown>];
        }
    }

    get icon() {
        return this.app.icon;
    }

    async reportError(message : string, error : Error & { code ?: string }) : Promise<void> {
        // cancellation errors should bubble up
        if (error.code === 'ECANCELLED')
            throw error;

        console.error(message, error);
        this.app.setError(error);
        await this._outputDelegate.notifyError(error);
    }

    async output(outputType : string, outputValues : Record<string, unknown>) : Promise<void> {
        await this._outputDelegate.output(outputType, outputValues);
    }
}