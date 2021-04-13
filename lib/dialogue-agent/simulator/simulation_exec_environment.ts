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

import * as ThingTalk from 'thingtalk';
import { Ast, Type, ExecEnvironment, SchemaRetriever } from 'thingtalk';

import { coin, uniform, randint } from '../../utils/random';

import { SimulationDatabase } from './types';

type CompiledFilterHint = [string, string, unknown];
export interface CompiledQueryHints {
    filter ?: CompiledFilterHint[];
    sort ?: [string, 'asc' | 'desc'];
    projection ?: string[];
    limit ?: number;
}


class ResultGenerator {
    private _rng : () => number;
    private _overrides : Map<string, unknown>;
    private _candidates : Map<string, unknown[]>;
    private _constants : Map<string, unknown[]>;

    constructor(rng : () => number,
                overrides : Map<string, unknown>) {
        this._rng = rng;

        this._overrides = overrides;
        this._candidates = new Map;
        this._constants = new Map;
    }

    private _doAddCandidate(key : string, jsValue : unknown) {
        let candidates = this._candidates.get(key);
        if (candidates === undefined) {
            candidates = [];
            this._candidates.set(key, candidates);
        }
        candidates.push(jsValue);
    }

    addCandidate(value : Ast.Value) {
        if (value instanceof Ast.ArrayValue || !value.isConstant())
            return;

        if (value.isBoolean || value.isEnum)
            return;

        const jsValue = value.toJS();

        if (value.isString) {
            this._doAddCandidate('QUOTED_STRING', jsValue);
        } else if (value.isNumber) {
            this._doAddCandidate('NUMBER', jsValue);
        } else if (value.isCurrency) {
            this._doAddCandidate('CURRENCY', (jsValue as ThingTalk.Builtin.Currency).value);
        } else if (value.isMeasure) {
            const type = value.getType();
            assert(type instanceof Type.Measure);
            this._doAddCandidate('MEASURE_' + type.unit, jsValue);
        } else if (value.isTime) {
            this._doAddCandidate('TIME', jsValue);
        } else if (value.isDate) {
            this._doAddCandidate('DATE', jsValue);
        } else if (value.isLocation) {
            this._doAddCandidate('LOCATION', jsValue);
        } else if (value instanceof Ast.EntityValue) {
            this._doAddCandidate('ENTITY_' + value.type, String(jsValue));
        }
    }

    generate(schema : Ast.FunctionDef, params : Record<string, unknown>, index : number) {
        const result : Record<string, unknown> = {};
        Object.assign(result, params);
        for (const arg of schema.iterateArguments()) {
            if (arg.direction !== Ast.ArgDirection.OUT)
                continue;
            if (arg.name.indexOf('.') >= 0)
                continue;
            if (this._overrides.has(arg.name))
                result[arg.name] = this._overrides.get(arg.name);
            else if (arg.name === 'id' && arg.type instanceof Type.Entity)
                result[arg.name] = new ThingTalk.Builtin.Entity(`str:ENTITY_${arg.type.type}::${index}:`, null);
            else
                result[arg.name] = this._generateValue(arg.type, arg.name !== 'id', arg);
        }
        return result;
    }

    private _generateValue(type : Type, repeatable = true, arg ?: Ast.ArgumentDef) : unknown {
        if (type instanceof Type.Compound) {
            const result : Record<string, unknown> = {};
            for (const field in type.fields) {
                const arg = type.fields[field];
                assert(arg instanceof Ast.ArgumentDef);
                result[field] = this._generateValue(arg.type, true, arg);
            }
            return result;
        }

        if (type instanceof Type.Array) {
            const length = randint(1, 3, this._rng);
            const buffer : unknown[] = [];
            // do not repeat values inside the array
            for (let i = 0; i < length; i++)
                buffer.push(this._generateValue(type.elem as Type, false, arg));
            return buffer;
        }

        if (type.isBoolean)
            return !!coin(0.5, this._rng);
        if (type.isString)
            return this._generateString(`QUOTED_STRING`, repeatable);
        if (type.isNumber)
            return this._generateNumber(`NUMBER`, repeatable, arg);
        if (type instanceof Type.Measure)
            return this._generateNumber(`MEASURE_` + type.unit, repeatable, arg);
        if (type.isCurrency)
            return new ThingTalk.Builtin.Currency(this._generateNumber(`CURRENCY`, repeatable), 'usd');
        if (type.isTime)
            return this._generateTime(repeatable);
        if (type.isDate)
            return this._generateDate(repeatable);
        if (type.isLocation)
            return this._generateLocation(repeatable);
        if (type instanceof Type.Enum)
            return uniform(type.entries!, this._rng);
        if (type instanceof Type.Entity)
            return new ThingTalk.Builtin.Entity(this._generateString('ENTITY_' + type.type, repeatable), null);
        if (type === Type.RecurrentTimeSpecification) {
            // TODO
            return [new ThingTalk.Builtin.RecurrentTimeRule({
                beginTime: new ThingTalk.Builtin.Time(0,0),
                endTime: new ThingTalk.Builtin.Time(24,0),
                interval: 86400000,
                frequency: 1,
                dayOfWeek: null,
                beginDate: null,
                endDate: null,
                subtract: false
            })];
        }

        throw new TypeError(`Invalid constant of type ${type}`);
    }

    private _generateTime(repeatable : boolean) {
        const reused = this._reuseConstant('TIME', repeatable);
        if (reused !== undefined)
            return reused;

        const newTime = new ThingTalk.Builtin.Time(randint(0, 23, this._rng), randint(0, 59, this._rng), 0);
        this._constants.get('TIME')!.push(newTime);
        return newTime;
    }

    private _generateDate(repeatable : boolean) {
        const reused = this._reuseConstant('DATE', repeatable);
        if (reused !== undefined)
            return reused;

        const num = this._generateNumber('DATE::number', repeatable);
        assert(Number.isFinite(num));
        const date = new Date(2018, 0, num);
        assert(Number.isFinite(date.getTime()));
        return date;
    }

    private _generateLocation(repeatable : boolean) {
        const reused = this._reuseConstant('LOCATION', repeatable);
        if (reused !== undefined)
            return reused;

        const lat = randint(-90, 90, this._rng);
        const lon = randint(-180, 180, this._rng);
        const newLocation = new ThingTalk.Builtin.Location(lat, lon, null);
        this._constants.get('LOCATION')!.push(newLocation);
        return newLocation;
    }

    private _generateNumber(key : string, repeatable : boolean, arg ?: Ast.ArgumentDef) : number {
        const reused = this._reuseConstant(key, repeatable);
        if (reused !== undefined)
            return reused as number;

        let min, max;
        min = 20;
        max = 1000;
        if (arg) {
            const minArg = arg.getImplementationAnnotation<number>('min_number');
            if (minArg !== undefined) {
                min = minArg;
                max = Math.max(max, minArg + 20);
            }
            const maxArg = arg.getImplementationAnnotation<number>('max_number');
            if (maxArg !== undefined)
                max = maxArg;
        }

        // with 50% probability, generate a "small" number
        if (coin(0.5, this._rng)) {
            min = Math.max(min, 1);
            max = Math.min(max, 20);
        }
        if (max <= min)
            max = min;

        const newNumber = randint(min, max, this._rng);
        assert(Number.isFinite(newNumber));
        this._constants.get(key)!.push(newNumber);
        return newNumber;
    }

    private _generateString(key : string, repeatable : boolean) : string {
        const reused = this._reuseConstant(key, repeatable) as string|undefined;
        if (reused !== undefined)
            return reused;

        const newString = `str:${key}::${Math.floor(this._rng() * 50)}:`;
        this._constants.get(key)!.push(newString);
        return newString;
    }

    generateString() : string {
        return this._generateString('QUOTED_STRING', false);
    }

    private _reuseConstant(key : string, repeatable : boolean) : unknown|undefined {
        // first check if we have something in the program already
        const candidates = this._candidates.get(key);
        if (repeatable && candidates && candidates.length > 0 && coin(0.5, this._rng))
            return uniform(candidates, this._rng);

        // then try to reuse one of the constants we already generated
        let previous = this._constants.get(key);
        if (previous === undefined) {
            previous = [];
            this._constants.set(key, previous);
        }

        if (repeatable && previous.length > 0 && coin(0.1, this._rng))
            return uniform(previous, this._rng);

        return undefined;
    }
}

class SimulatedError extends Error {
    code : string|undefined;

    constructor(message : string, code ?: string) {
        super(message);
        this.code = code;
    }
}

function parseTime(v : unknown) {
    if (typeof v === 'string') {
        const [hourstr, minutestr, secondstr] = v.split(':');
        const hour = parseInt(hourstr);
        const minute = parseInt(minutestr);
        let second;
        if (secondstr === undefined)
            second = 0;
        else
            second = parseInt(secondstr);
        return new ThingTalk.Time(hour, minute, second);
    } else {
        const time = v as { hour : number, minute : number, second ?: number };
        return new ThingTalk.Time(time.hour, time.minute, time.second);
    }
}

function loadSimulationValue(schema : Ast.FunctionDef,
                             type : Type,
                             value : unknown,
                             keyPrefix : string) : unknown {
    if (value === null || value === undefined)
        return undefined;

    if (type instanceof Type.Array)
        return (value as unknown[]).map((v) => loadSimulationValue(schema, type.elem as Type, v, keyPrefix));

    if (type instanceof Type.Compound) {
        const mapped : Record<string, unknown> = {};
        for (const key in (value as Record<string, unknown>)) {
            const inner = (value as Record<string, unknown>)[key];
            const arg = schema.getArgument(keyPrefix + key)!;
            mapped[key] = loadSimulationValue(schema, arg.type, inner, keyPrefix + key + '.');
        }
        return mapped;
    }

    if (type instanceof Type.Entity) {
        if (typeof value === 'object') {
            const entity = value as { value : string; display : string|null };
            return new ThingTalk.Entity(entity.value, entity.display);
        } else {
            return new ThingTalk.Entity(value as string, null);
        }
    }
    if (type.isLocation) {
        const loc = value as [number, number, string|null];
        return new ThingTalk.Location(loc[0], loc[1], loc[2]);
    }
    if (type.isTime)
        return parseTime(value);
    if (type.isDate)
        return new Date(value as string|number);

    return value;
}

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

function genFakeData(size : number, fill : number) {
    return String(Buffer.alloc(size, fill));
}

class SimpleTestDevice {
    private _sequenceNumber = 0;

    next_sequence() {
        return [{ number: this._sequenceNumber ++ }];
    }

    async *get_data({ size, count } : { size : number, count : number }) {
        if (!(count >= 0))
            count = 1;
        for (let i = 0; i < count; i++)
            yield ({ data: genFakeData(size, '!'.charCodeAt(0) + i) });
    }
    async *get_data2({ size, count } : { size : number, count : number }) {
        if (!(count >= 0))
            count = 1;
        for (let i = 0; i < count; i++)
            yield ({ data: genFakeData(size, 'A'.charCodeAt(0) + i) });
    }
    dup_data({ data_in } : { data_in : string }) {
        return [{ data_out: data_in + data_in }];
    }
}

class SimulationExecEnvironment extends ExecEnvironment {
    private _schemas : SchemaRetriever;
    private _database : SimulationDatabase|undefined;
    private _rng : () => number;
    private _simulateErrors : boolean;
    private _testDevice = new SimpleTestDevice();

    private _execCache : Array<[string, Record<string, unknown>, Array<[string, Record<string, unknown>]>]>;

    output ! : (type : string, value : Record<string, unknown>) => Promise<void>;
    generator : ResultGenerator|null;

    constructor(locale : string,
                timezone : string|undefined,
                schemas : SchemaRetriever,
                database : SimulationDatabase|undefined,
                { rng, simulateErrors = true } : { rng : () => number, simulateErrors ?: boolean }) {
        super();
        this._execCache = [];

        this._schemas = schemas;
        this._database = database;
        this._rng = rng;
        this._simulateErrors = simulateErrors;

        this.generator = null;
    }

    get program_id() {
        return new ThingTalk.Entity('uuid-simulation', null);
    }

    clearGetCache() {
        // do not actually clear the get cache
        // all queries are expected to return consistent results
    }

    private _findInCache(functionKey : string, params : Record<string, unknown>) : Array<[string, Record<string, unknown>]>|null {
        for (const cached of this._execCache) {
            const [_function, cachedparams, result] = cached;
            if (_function === functionKey &&
                ThingTalk.Builtin.equality(cachedparams, params))
                return result;
        }
        return null;
    }

    private _failAction(schema : Ast.FunctionDef) : never {
        const errors = Object.keys(schema.metadata.on_error || {});
        if (errors.length === 0)
            throw new SimulatedError(this.generator!.generateString());
        else
            throw new SimulatedError(this.generator!.generateString(), uniform(errors, this._rng));
    }

    async *invokeAction(kind : string,
                        attrs : Record<string, string>,
                        fname : string,
                        params : Record<string, unknown>) : AsyncIterable<[string, Record<string, unknown>]> {
        const outputType = kind + ':action/' + fname;
        const schema = await this._schemas.getMeta(kind, 'action', fname);

        const fromDB = await this._tryFromSimulationDatabase(schema, 'action', kind, fname, params, null);
        if (fromDB) {
            for (const el of fromDB)
                yield el;
            return;
        }

        // with some probability, fail the action
        if (this._simulateErrors && coin(0.1, this._rng)) {
            await this._failAction(schema);
            return;
        }

        let anyOutArgument = false;
        for (const arg of schema.iterateArguments()) {
            if (!arg.is_input) {
                anyOutArgument = true;
                break;
            }
        }

        if (anyOutArgument)
            yield [outputType, this.generator!.generate(schema, params, 0)];
    }

    private _tryFromSimulationDatabase(schema : Ast.FunctionDef,
                                       ftype : 'query',
                                       kind : string,
                                       fname : string,
                                       params : Record<string, unknown>,
                                       hints : CompiledQueryHints) : Promise<[Array<[string, Record<string, unknown>]>, boolean]|null>;
    private _tryFromSimulationDatabase(schema : Ast.FunctionDef,
                                       ftype : 'action',
                                       kind : string,
                                       fname : string,
                                       params : Record<string, unknown>,
                                       hints : null) : Promise<Array<[string, Record<string, unknown>]>|null>;
    private async _tryFromSimulationDatabase(schema : Ast.FunctionDef,
                                             ftype : 'query'|'action',
                                             kind : string,
                                             fname : string,
                                             params : Record<string, unknown>,
                                             hints : CompiledQueryHints|null) {
        let outputType : string, dbKey : string;
        if (ftype === 'action') {
            outputType = kind + ':action/' + fname;
            dbKey = kind + ':' + fname;
        } else {
            outputType = dbKey = kind + ':' + fname;
        }
        if (!this._database || !this._database.has(dbKey))
            return null;

        const data = this._database.get(dbKey)!;

        if (hints) {
            // HACK: sort multiwoz train search results so that the context is correct already
            // if the user is searching by arrive_by, sort by arrive_by desc

            if (hints.filter && hints.filter.some(([pname,]) => pname === 'arrive_by')) {
                data.sort((one, two) => {
                    if ((one.arrive_by as number) < (two.arrive_by as number))
                        return 1;
                    if ((two.arrive_by as number) < (one.arrive_by as number))
                        return -1;
                    return 0;
                });
            }
            // if the user is searching by leave_at, sort by leave_at asc
            if (hints.filter && hints.filter.some(([pname,]) => pname === 'leave_at')) {
                data.sort((one, two) => {
                    if ((one.leave_at as number) < (two.leave_at as number))
                        return -1;
                    if ((two.leave_at as number) < (one.leave_at as number))
                        return 1;
                    return 0;
                });
            }
        }

        const mapped = data.map((item) : [string, Record<string, unknown>] => {
            const mapped : Record<string, unknown> = {};
            for (const key in item) {
                if (key === '$error') {
                    mapped[key] = item[key];
                    continue;
                }
                const value = item[key];
                const arg = schema.getArgument(key);
                if (!arg)
                    continue;
                mapped[key] = loadSimulationValue(schema, arg.type, value, '');
            }

            return [outputType, mapped];
        }).filter(([outputType, data]) => {
            for (const key in params) {
                const pvalue = params[key];
                const dvalue = data[key];
                if (!dvalue)
                    continue;
                if (!ThingTalk.Builtin.equality(pvalue, dvalue))
                    return false;
            }
            return true;
        });

        if (mapped.length === 0)
            return null;

        if (ftype === 'action') {
            const choice = uniform(mapped, this._rng);
            if (choice[1].$error) {
                const err = choice[1].$error as { message : string, code : string };
                throw new SimulatedError(err.message, err.code);
            }
            return [choice];
        } else {
            // note: if the query is a list, we return everything, and the query response is not
            // cached between successive statements, so we can change the sort order depending on
            // what the user is filtering for
            // if the query is a single result, the result is cached if the query is monitorable
            // so we return consistent results to later projection questions
            if (schema.is_list)
                return [mapped, false];

            const choice = uniform(mapped, this._rng);
            if (choice[1].$error) {
                const err = choice[1].$error as { message : string, code : string };
                throw new SimulatedError(err.message, err.code);
            }
            return [[choice], schema.is_monitorable];
        }
    }

    private async _doInvokeQuery(kind : string,
                                 fname : string,
                                 params : Record<string, unknown>,
                                 hints : CompiledQueryHints) : Promise<[Array<[string, Record<string, unknown>]>, boolean]> {
        const outputType = kind + ':' + fname;
        const schema = await this._schemas.getMeta(kind, 'query', fname);

        const fromDB = await this._tryFromSimulationDatabase(schema, 'query', kind, fname, params, hints);
        if (fromDB)
            return fromDB;

        if (kind === 'org.thingpedia.builtin.test') {
            const results : Array<[string, Record<string, unknown>]> = [];
            for await (const result of (this._testDevice[fname as ('get_data'|'get_data2'|'dup_data'|'next_sequence')](params as any))) {
                Object.assign(result, params);
                results.push([outputType, result]);
            }
            return [results, false];
        }

        // with some probability, fail the query
        if (this._simulateErrors && coin(0.1, this._rng)) {
            await this._failAction(schema);
            return [[], false];
        }

        let numResults, cacheable;
        if (schema.is_list) {
            // with some probability, return no results, so we hit the search error path
            if (coin(0.1, this._rng)) {
                numResults = 0;
                cacheable = false;
            } else {
                numResults = randint(50, 100, this._rng);
                cacheable = true;
            }
        } else {
            numResults = 1;
            cacheable = true;
        }

        const results : Array<[string, Record<string, unknown>]> = [];
        for (let i = 0; i < numResults; i++)
            results.push([outputType, this.generator!.generate(schema, params, i)]);

        return [results, cacheable];
    }

    async *invokeQuery(kind : string,
                       attrs : Record<string, string>,
                       fname : string,
                       params : Record<string, unknown>,
                       hints : CompiledQueryHints) : AsyncIterable<[string, Record<string, unknown>]> {
        const functionKey = kind + ':' + fname;
        const cached = this._findInCache(functionKey, params);
        if (cached) {
            for (const el of cached)
                yield el;
            return;
        }

        const [list, cacheable] = await this._doInvokeQuery(kind, fname, params, hints);
        if (cacheable)
            this._execCache.push([functionKey, params, list]);
        for (const el of list)
            yield el;
    }

    async *invokeDBQuery(kind : string,
                         attrs : Record<string, string>,
                         query : Ast.Program) : AsyncIterable<[string, Record<string, unknown>]> {
        assert.strictEqual(query.statements.length, 1);
        const command = query.statements[0];
        assert(command instanceof Ast.ExpressionStatement);

        const schema = command.expression.schema;
        assert(schema);

        const numResults = randint(50, 100, this._rng);
        const outputType = recursivelyComputeOutputType(kind, command.expression);
        for (let i = 0; i < numResults; i++)
            yield [outputType, this.generator!.generate(schema, {}, i)];
    }

    async formatEvent(outputType : string, output : Record<string, unknown>, hint : string) : Promise<string> {
        return this.generator!.generateString();
    }
}

export {
    ResultGenerator,
    SimulationExecEnvironment,
    SimulatedError
};
