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
import { Ast, Runtime } from 'thingtalk';
import MonitorRunner from './monitor_runner';

import { Timer, AtTimer, OnTimer } from './timers';
import DeviceView from '../devices/device_view';
import NotificationFormatter from '../../dialogue-agent/notifications/formatter';
import RestartableAsyncIterable from '../util/restartable_async_iterable';

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

export interface OutputDelegate {
    done() : void;
    output(outputType : string, outputValue : Record<string, unknown>) : void;
    error(error : Error) : void;
}

type MaybePromise<T> = T|Promise<T>;
type ActionFunction = (params : Record<string, unknown>, env : ExecWrapper) => MaybePromise<unknown>;

type QueryFunctionResult = AsyncIterable<Record<string, unknown>>;
type QueryFunction = (params : Record<string, unknown>, hints : Runtime.CompiledQueryHints, env : ExecWrapper) => MaybePromise<QueryFunctionResult>;

function recursivelyComputeOutputType(kind : string, expr : Ast.Expression) : string {
    if (expr instanceof Ast.InvocationExpression)
        return kind + ':' + expr.invocation.channel;
    if (expr instanceof Ast.ChainExpression)
        return expr.expressions.map((exp) => recursivelyComputeOutputType(kind, exp)).join('+');
    if (expr instanceof Ast.AggregationExpression)
        return expr.operator + '(' + recursivelyComputeOutputType(kind, expr.expression) + ')';
    if ('expression' in expr) // projection, index, slice
        return recursivelyComputeOutputType(kind, (expr as ({ expression : Ast.Expression } & Ast.Expression)).expression);

    throw new TypeError('Invalid query expression ' + expr);
}

// eslint-disable-next-line @typescript-eslint/ban-types
function isPlainObject(x : unknown) : x is object {
    return typeof x === 'object' && x !== null &&
        typeof (x as any).then !== 'function' &&
        typeof (x as any).next !== 'function' &&
        (Object.getPrototypeOf(x) === Object.prototype ||
        Object.getPrototypeOf(x) === null);
}

/**
 * Wrap a ThingTalk statement and provide access to the Engine.
 *
 * This is an implementation of {@link external:thingtalk.ExecEnvironment}
 * suitable for running with the Genie engine.
 *
 * @package
 */
export default class ExecWrapper extends Runtime.ExecEnvironment {
    engine : Engine;
    app : AppExecutor;
    format : NotificationFormatter;

    private _programId : ThingTalk.Builtin.Entity;
    private _outputDelegate : OutputDelegate;
    private _trigger : MonitorRunner|Timer|AtTimer|OnTimer|null;

    private _execCache : Array<[string, string, Record<string, unknown>, Array<Promise<QueryFunctionResult>>]>;
    private _hooks : Array<() => void|Promise<void>>;

    constructor(engine : Engine, app : AppExecutor, output : OutputDelegate) {
        super();

        this.format = new NotificationFormatter(engine);
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
    /**
     * Retrieve the unique ID of the conversation associated with this execution
     * environment.
     *
     * This roughly corresponds to the ID of the session or speaker where the user
     * is issuing the command.
     */
    get conversation() {
        return this.app.metadata.conversation;
    }

    get locale() {
        return this.engine.platform.locale;
    }

    get timezone() {
        return this.engine.platform.timezone;
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
        const trigger = new Timer(base.getTime(), interval, frequency);
        this._trigger = trigger;
        trigger.start();
        return this._wrapClearCache(trigger);
    }

    invokeAtTimer(time : ThingTalk.Builtin.Time[], expiration_date : Date|undefined) : AsyncIterator<{ __timestamp : number }> {
        const trigger = new AtTimer(time, expiration_date, this.timezone);
        this._trigger = trigger;
        trigger.start();
        return this._wrapClearCache(trigger);
    }

    invokeOnTimer(date : Date[]) : AsyncIterator<{ __timestamp : number}> {
        const trigger = new OnTimer(date);
        this._trigger = trigger;
        trigger.start();
        return this._wrapClearCache(trigger);
    }

    invokeMonitor(kind : string,
                  attrs : Record<string, string>,
                  fname : string,
                  params : Record<string, unknown>,
                  hints : Runtime.CompiledQueryHints) : AsyncIterator<[string, Record<string, unknown> & { __timestamp : number }]> {
        const trigger = new MonitorRunner(this, new DeviceView(this.engine.devices, kind, attrs), fname, params, hints);
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
                       hints : Runtime.CompiledQueryHints) : AsyncIterable<[string, Record<string, unknown>]> {
        const devices = this._getDevices(kind, attrs);

        let promises : Array<Promise<QueryFunctionResult>>;
        const cached = this._findInCache(kind, fname, params);
        if (cached) {
            promises = cached;
        } else {
            const js_function_name = 'get_' + fname;

            promises = devices.map(async (d) => {
                return new RestartableAsyncIterable(await (d as unknown as Record<string, QueryFunction>)[js_function_name](params, hints, this));
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
                if (device.uniqueId !== device.kind)
                    element.__device = new Tp.Value.Entity(device.uniqueId!, device.name);
                yield [outputType, element];
            }
        }
    }

    async *invokeDBQuery(kind : string, attrs : Record<string, string>, query : Ast.Program) : AsyncIterable<[string, Record<string, unknown>]> {
        const devices = this._getDevices(kind, attrs) as any[]; // FIXME

        const command = query.statements[0];
        assert(command instanceof Ast.ExpressionStatement);

        for (const device of devices) {
            const outputType = recursivelyComputeOutputType(device.kind, command.expression);
            for await (const result of await device.query(query, this))
                yield [outputType, result];
        }
    }

    readState(stateId : number) {
        return this.app.readState(stateId);
    }
    async writeState(stateId : number, state : unknown) {
        await this.app.writeState(stateId, state);
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
            if (typeof result !== 'undefined' && !isPlainObject(result)) {
                console.error(`${outputType} returned a value that is not an object and not undefined; this is deprecated and might break in the future`);
                result = undefined;
            }
            if (result === undefined)
                result = {};
            extendParams(result as Record<string, unknown>, params);

            if (result) {
                if (d.uniqueId !== d.kind)
                    (result as Record<string, unknown>).__device = new Tp.Value.Entity(d.uniqueId!, d.name);
                yield [outputType, result as Record<string, unknown>];
            } else {
                if (d.uniqueId !== d.kind) {
                    const __device = new Tp.Value.Entity(d.uniqueId!, d.name);
                    yield [outputType, { __device }];
                } else {
                    yield [outputType, {}];
                }
            }
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
        await this._outputDelegate.error(error);
    }

    async output(outputType : string, outputValues : Record<string, unknown>) : Promise<void> {
        await this._outputDelegate.output(outputType, outputValues);
    }

    async formatEvent(outputType : string, outputValue : Record<string, unknown>, hint : string) : Promise<string> {
        const formatted = await this.format.formatNotification(null, this.app.program, outputType, outputValue);
        return formatted.map((x) => x.toLocaleString(this.engine.platform.locale)).join('\n');
    }
}
