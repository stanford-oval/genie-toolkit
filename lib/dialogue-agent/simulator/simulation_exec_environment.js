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

const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const { coin, uniform, randint } = require('../../utils/random');

class ResultGenerator {
    constructor(rng, overrides) {
        this._rng = rng;

        this._overrides = overrides;
        this._candidates = new Map;
        this._constants = new Map;
        this._results = [];
    }

    _doAddCandidate(key, jsValue) {
        let candidates = this._candidates.get(key);
        if (candidates === undefined) {
            candidates = [];
            this._candidates.set(key, candidates);
        }
        candidates.push(jsValue);
    }

    addCandidate(value) {
        if (value.isArray || !value.isConstant())
            return;

        if (value.isBoolean || value.isEnum)
            return;

        const jsValue = value.toJS();

        if (value.isString)
            this._doAddCandidate('QUOTED_STRING', jsValue);
        else if (value.isNumber)
            this._doAddCandidate('NUMBER', jsValue);
        else if (value.isCurrency)
            this._doAddCandidate('CURRENCY', jsValue.value);
        else if (value.isMeasure)
            this._doAddCandidate('MEASURE_' + value.getType().type, jsValue);
        else if (value.isTime)
            this._doAddCandidate('TIME', jsValue);
        else if (value.isDate)
            this._doAddCandidate('DATE', jsValue);
        else if (value.isLocation)
            this._doAddCandidate('LOCATION', jsValue);
        else if (value.isEntity)
            this._doAddCandidate('ENTITY_' + value.type, String(jsValue));
    }

    generate(schema, params, index) {
        let result = {};
        Object.assign(result, params);
        for (let arg of schema.iterateArguments()) {
            if (arg.direction !== Ast.ArgDirection.OUT)
                continue;
            if (arg.name.indexOf('.') >= 0)
                continue;
            if (this._overrides.has(arg.name))
                result[arg.name] = this._overrides.get(arg.name);
            else if (arg.name === 'id' && arg.type.isEntity)
                result[arg.name] = new ThingTalk.Builtin.Entity(`str:ENTITY_${arg.type.type}::${index}:`, null);
            else
                result[arg.name] = this._generateValue(arg.type, arg.name !== 'id', arg);
        }
        return result;
    }

    _generateValue(type, repeatable = true, arg) {
        if (type.isCompound) {
            let result = {};
            for (let field in type.fields) {
                const arg = type.fields[field];
                assert(arg instanceof Ast.ArgumentDef);
                result[field] = this._generateValue(arg.type, true, arg);
            }
            return result;
        }

        if (type.isArray) {
            let length = randint(1, 3, this._rng);
            let buffer = [];
            // do not repeat values inside the array
            for (let i = 0; i < length; i++)
                buffer.push(this._generateValue(type.elem, false, arg));
            return buffer;
        }

        if (type.isBoolean)
            return !!coin(0.5, this._rng);
        if (type.isString)
            return this._generateString(`QUOTED_STRING`, repeatable);
        if (type.isNumber)
            return this._generateNumber(`NUMBER`, repeatable, arg);
        if (type.isMeasure)
            return this._generateNumber(`MEASURE_` + type.unit, repeatable, arg);
        if (type.isCurrency)
            return new ThingTalk.Builtin.Currency(this._generateNumber(`CURRENCY`, repeatable), 'usd');
        if (type.isTime)
            return this._generateTime(repeatable);
        if (type.isDate)
            return this._generateDate(repeatable);
        if (type.isLocation)
            return this._generateLocation(repeatable);
        if (type.isEnum)
            return uniform(type.entries, this._rng);
        if (type.isEntity)
            return new ThingTalk.Builtin.Entity(this._generateString('ENTITY_' + type.type, repeatable), null);

        throw new TypeError(`Invalid constant of type ${type}`);
    }

    _generateTime(repeatable) {
        const reused = this._reuseConstant('TIME', repeatable);
        if (reused !== undefined)
            return reused;

        const newTime = new ThingTalk.Builtin.Time(randint(0, 23), randint(0, 59), 0);
        this._constants.get('TIME').push(newTime);
        return newTime;
    }

    _generateDate(repeatable) {
        const reused = this._reuseConstant('DATE', repeatable);
        if (reused !== undefined)
            return reused;

        const num = this._generateNumber('DATE::number', repeatable);
        assert(Number.isFinite(num));
        const date = new Date(2018, 0, num);
        assert(Number.isFinite(date.getTime()));
        return date;
    }

    _generateLocation(repeatable) {
        const reused = this._reuseConstant('LOCATION', repeatable);
        if (reused !== undefined)
            return reused;

        const lat = randint(-90, 90, this._rng);
        const lon = randint(-180, 180, this._rng);
        const newLocation = new ThingTalk.Builtin.Location(lat, lon, null);
        this._constants.get('LOCATION').push(newLocation);
        return newLocation;
    }

    _generateNumber(key, repeatable, arg) {
        const reused = this._reuseConstant(key, repeatable);
        if (reused !== undefined)
            return reused;

        let min, max;
        min = 20;
        max = 1000;
        if (arg) {
            let minArg = arg.getImplementationAnnotation('min_number');
            if (minArg !== undefined) {
                min = minArg;
                max = Math.max(max, minArg + 20);
            }
            let maxArg = arg.getImplementationAnnotation('max_number');
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

        let newNumber = randint(min, max, this._rng);
        assert(Number.isFinite(newNumber));
        this._constants.get(key).push(newNumber);
        return newNumber;
    }

    _generateString(key, repeatable) {
        const reused = this._reuseConstant(key, repeatable);
        if (reused !== undefined)
            return reused;

        const newString = `str:${key}::${Math.floor(this._rng() * 50)}:`;
        this._constants.get(key).push(newString);
        return newString;
    }

    generateString() {
        return this._generateString('QUOTED_STRING', false);
    }

    _reuseConstant(key, repeatable) {
        // first check if we have something in the program already
        let candidates = this._candidates.get(key);
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
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}

function parseTime(v) {
    if (typeof v === 'string') {
        let [hour, minute, second] = v.split(':');
        hour = parseInt(hour);
        minute = parseInt(minute);
        if (second === undefined)
            second = 0;
        else
            second = parseInt(second);
        return new ThingTalk.Time(hour, minute, second);
    } else {
        return new ThingTalk.Time(v.hour, v.minute, v.second);
    }
}

function loadSimulationValue(schema, type, value, keyPrefix) {
    if (type.isArray)
        return value.map((v) => loadSimulationValue(schema, type.elem, v, keyPrefix));

    if (type.isCompound) {
        const mapped = {};
        for (let key in value) {
            const inner = value[key];
            const arg = schema.getArgument(keyPrefix + key);
            mapped[key] = loadSimulationValue(schema, arg.type, inner, keyPrefix + key + '.');
        }
        return mapped;
    }

    if (type.isEntity) {
        if (typeof value === 'object')
            return new ThingTalk.Entity(value.value, value.display);
        else
            return new ThingTalk.Entity(value, null);
    }
    if (type.isLocation)
        return new ThingTalk.Location(value[0], value[1], value[2]);
    if (type.isTime)
        return parseTime(value);
    if (type.isDate)
        return new Date(value);

    return value;
}

class SimulationExecEnvironment extends ThingTalk.ExecEnvironment {
    constructor(locale, schemas, database, { rng, simulateErrors = true }) {
        super(locale, 'America/Los_Angeles', schemas);
        this._execCache = [];

        this._schemas = schemas;
        this._database = database;
        this._rng = rng;
        this._simulateErrors = simulateErrors;

        this.output = null;
        this.generator = null;
    }

    get program_id() {
        return new ThingTalk.Entity('uuid-simulation', null);
    }

    clearGetCache() {
        // do not actually clear the get cache
        // all queries are expected to return consistent results
    }

    _findInCache(functionKey, params) {
        for (let cached of this._execCache) {
            let [_function, cachedparams, result] = cached;
            if (_function === functionKey &&
                ThingTalk.Builtin.equality(cachedparams, params))
                return result;
        }
        return null;
    }

    async readResult(functionKey, index) {
        for (let i = this._execCache.length-1; i >= 0; i--) {
            let [_function,, result] = this._execCache[i];
            if (_function === functionKey) {
                index --;
                if (index === 0)
                    return result;
            }
        }
        throw new Error(`Invalid readResult, no result for ${functionKey}[${index}]`);
    }

    _failAction(schema) {
        const errors = Object.keys(schema.metadata.on_error || {});
        if (errors.length === 0)
            throw new SimulatedError(this.generator.generateString());
        else
            throw new SimulatedError(this.generator.generateString(), uniform(errors, this._rng));
    }

    async invokeAction(kind, attrs, fname, params) {
        const outputType = kind + ':action/' + fname;
        const schema = await this._schemas.getMeta(kind, 'action', fname);

        const fromDB = await this._tryFromSimulationDatabase(schema, 'action', kind, fname, params, null);
        if (fromDB)
            return fromDB;

        // with some probability, fail the action
        if (this._simulateErrors && coin(0.1, this._rng)) {
            await this._failAction(schema);
            return undefined;
        }

        let anyOutArgument = false;
        for (let arg of schema.iterateArguments()) {
            if (!arg.is_input) {
                anyOutArgument = true;
                break;
            }
        }

        if (anyOutArgument)
            return [[outputType, this.generator.generate(schema, params, 0)]];

        return undefined;
    }

    async _tryFromSimulationDatabase(schema, ftype, kind, fname, params, hints) {
        let outputType, dbKey;
        if (ftype === 'action') {
            outputType = kind + ':action/' + fname;
            dbKey = kind + ':' + fname;
        } else {
            outputType = dbKey = kind + ':' + fname;
        }
        if (!this._database || !this._database.has(dbKey))
            return null;

        const data = this._database.get(dbKey);

        if (hints) {
            // HACK: sort multiwoz train search results so that the context is correct already
            // if the user is searching by arrive_by, sort by arrive_by desc

            if (hints.filter && hints.filter.some(([pname,]) => pname === 'arrive_by')) {
                data.sort((one, two) => {
                    if (one.arrive_by < two.arrive_by)
                        return 1;
                    if (two.arrive_by < one.arrive_by)
                        return -1;
                    return 0;
                });
            }
            // if the user is searching by leave_at, sort by leave_at asc
            if (hints.filter && hints.filter.some(([pname,]) => pname === 'leave_at')) {
                data.sort((one, two) => {
                    if (one.leave_at < two.leave_at)
                        return -1;
                    if (two.leave_at < one.leave_at)
                        return 1;
                    return 0;
                });
            }
        }

        const mapped = data.map((item) => {
            const mapped = {};
            for (let key in item) {
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
            for (let key in params) {
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
            if (choice[1].$error)
                throw new SimulatedError(choice[1].$error.message, choice[1].$error.code);
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
            if (choice[1].$error)
                throw new SimulatedError(choice[1].$error.message, choice[1].$error.code);
            return [[choice], schema.is_monitorable];
        }
    }

    async _doInvokeQuery(kind, fname, params, hints) {
        const outputType = kind + ':' + fname;
        const schema = await this._schemas.getMeta(kind, 'query', fname);

        const fromDB = await this._tryFromSimulationDatabase(schema, 'query', kind, fname, hints);
        if (fromDB)
            return fromDB;

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

        let results = [];
        for (let i = 0; i < numResults; i++)
            results.push([outputType, this.generator.generate(schema, params, i)]);

        return [results, cacheable];
    }

    async invokeQuery(kind, attrs, fname, params, hints) {
        const functionKey = kind + ':' + fname;
        const cached = this._findInCache(functionKey, params);
        if (cached)
            return Promise.resolve(cached);

        const [list, cacheable] = await this._doInvokeQuery(kind, fname, params, hints);
        if (cacheable)
            this._execCache.push([functionKey, params, list]);
        return list;
    }
}

module.exports = {
    ResultGenerator,
    SimulationExecEnvironment,
    SimulatedError
};
