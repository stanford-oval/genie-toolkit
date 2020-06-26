// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;

const { coin, uniform, randint } = require('../../utils/random');
const { collectDisambiguationHints, getBestEntityMatch } = require('../../utils/entity-finder');

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
            else if (arg.name === 'id')
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

        const lat = this._generateNumber('LOCATION::lat', repeatable);
        const lon = this._generateNumber('LOCATION::lon', repeatable);
        const newLocation = new ThingTalk.Builtin.Location(lat, lon, null);
        this._constants.get('LOCATION').push(newLocation);
        return newLocation;
    }

    _generateNumber(key, repeatable, arg) {
        const reused = this._reuseConstant(key, repeatable);
        if (reused !== undefined)
            return reused;

        let min, max;
        // with 50% probability, generate a "small" number
        if (coin(0.5, this._rng)) {
            min = 1;
            max = 20;
        } else {
            min = 20;
            max = 1000;
        }
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

class SimulationExecEnvironment extends ThingTalk.ExecEnvironment {
    constructor(locale, schemas, database, rng, output) {
        super(locale, 'America/Los_Angeles', schemas);
        this._execCache = [];

        this._rng = rng;
        this._schemas = schemas;
        this._database = database;

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

        // with some probability, fail the action
        if (coin(0.1, this._rng)) {
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

    async _doInvokeQuery(kind, fname, params, hints) {
        const outputType = kind + ':' + fname;
        const schema = await this._schemas.getMeta(kind, 'query', fname);
        if (this._database && this._database.has(outputType)) {
            const data = this._database.get(outputType);

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

            // note: the query response is not cached between successive statements,
            // so we can change the sort order depending on what the user is filtering for

            return [data.map((item) => {
                let mapped = {};
                for (let key in item) {
                    let value = item[key];
                    let arg = schema.getArgument(key);
                    if (arg && arg.type.isEntity && typeof value === 'object')
                        value = new ThingTalk.Entity(value.value, value.display);
                    else if (arg && arg.type.isLocation)
                        value = new ThingTalk.Location(value[0], value[1]);
                    else if (arg && arg.type.isTime)
                        value = parseTime(value);
                    mapped[key] = value;
                }

                return [outputType, mapped];
            }), false];
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

// above MORE_SIZE, we set the "more" bit
const MORE_SIZE = 50;
// above PAGE_SIZE, we set the count but don't actually show the full list of results
const PAGE_SIZE = 10;

class ThingTalkSimulatorState {
    constructor(options) {
        this._locale = options.locale;
        this._schemas = options.schemaRetriever;
        this._rng = options.rng;
        this._database = options.database;
        this._overrides = options.overrides || new Map;

        this._execEnv = new SimulationExecEnvironment(this._locale, this._schemas, this._database, this._rng);
        this._previousIdEntities = new Map;
    }

     async compile(stmt, cache) {
        const clone = stmt.clone();

        const previousIdEntities = this._previousIdEntities;
        clone.visit(new class extends Ast.NodeVisitor {
            visitValue(value) {
                if (value.isLocation && value.value.isRelative) {
                    switch (value.value.relativeTag) {
                    case 'current_location':
                        value.value = new Ast.Location.Absolute(2, 2, 'here');
                        break;
                    case 'home':
                        value.value = new Ast.Location.Absolute(3, 3, 'home');
                        break;
                    case 'work':
                        value.value = new Ast.Location.Absolute(4, 4, 'work');
                        break;
                    }
                }
                if (value.isEntity && value.value === null) {
                    const resolved = getBestEntityMatch(value.display, previousIdEntities.get(value.type) || []);
                    if (resolved) {
                        value.value = resolved.value;
                        value.display = resolved.name;
                    }
                }
                assert(value.isConcrete());
                return true;
            }
        });

        const program = new Ast.Program(null, [], [], [clone]);
        const cacheKey = program.prettyprint();
        //console.error(cacheKey);

        let compiled = cache.get(cacheKey);
        if (compiled)
            return compiled;

        try {
            const compiler = new ThingTalk.Compiler(this._schemas);

            compiled = await compiler.compileProgram(program);
            assert(compiled.rules.length === 0);
            cache.set(cacheKey, compiled);
        } catch(e) {
            console.error(`Failed to compile program: ` + e.message);
            console.error(program.prettyprint());
            throw e;
        }
        return compiled;
    }

    async simulate(stmt, compiled) {
        const results = [];
        let error = null;
        const generator = new ResultGenerator(this._rng, this._overrides);
        for (let slot of stmt.iterateSlots2()) {
            if (slot instanceof Ast.Selector)
                continue;
            generator.addCandidate(slot.get());
        }
        this._execEnv.generator = generator;
        this._execEnv.output = async (outputType, outputValue) => {
            const mapped = new Ast.DialogueHistoryResultItem(null, await this._mapResult(outputType, outputValue));
            collectDisambiguationHints(mapped, this._previousIdEntities);
            results.push(mapped);
        };
        this._execEnv.reportError = async (msg, err) => {
            if (!(err instanceof SimulatedError)) {
                console.error(`Failed to execute program`);
                console.error(msg, err);
                console.error(new Ast.Program(null, [], [], [stmt]).prettyprint());
                process.exit(1);
                return;
            }
            if (err.code)
                error = new Ast.Value.Enum(err.code);
            else
                error = new Ast.Value.String(err.message);
        };

        try {
            await compiled.command(this._execEnv);
        } catch(e) {
            console.error(`Failed to execute program: ` + e.message);
            console.error(new Ast.Program(null, [], [], [stmt]).prettyprint());
            throw e;
        }

        const numResults = results.length;
        return new Ast.DialogueHistoryResultList(null, results.slice(0, PAGE_SIZE),
            new Ast.Value.Number(Math.min(MORE_SIZE, numResults)), numResults > MORE_SIZE, error);
    }

    _inferType(jsValue) {
        if (typeof jsValue === 'boolean')
            return Type.Boolean;
        if (typeof jsValue === 'string')
            return Type.String;
        if (typeof jsValue === 'number')
            return Type.Number;
        if (jsValue instanceof ThingTalk.Builtin.Currency)
            return Type.Currency;
        if (jsValue instanceof ThingTalk.Builtin.Entity)
            return Type.Entity('');
        if (jsValue instanceof ThingTalk.Builtin.Time)
            return Type.Time;
        if (jsValue instanceof Date)
            return Type.Date;
        if (Array.isArray(jsValue) && jsValue.length > 0)
            return Type.Array(this._inferType(jsValue[0]));
        if (Array.isArray(jsValue))
            return Type.Array(Type.Any);

        return Type.Any;
    }

    _outputTypeToSchema(outputType) {
        let [kind, fname] = outputType.split(':');
        let ftype = 'query';
        if (fname.startsWith('action/')) {
            ftype = 'action';
            fname = fname.substring('action/'.length);
        }
        return this._schemas.getSchemaAndNames(kind, ftype, fname);
    }

    async _mapResult(outputType, outputValue) {
        const mappedResult = {};
        if (outputType === null) {
            // fallback
            for (let key in outputValue) {
                const jsValue = outputValue[key];
                mappedResult[key] = Ast.Value.fromJS(this._inferType(jsValue), jsValue);
            }
            return mappedResult;
        }

        if (outputType.indexOf('+') >= 0) {
            let types = outputType.split('+');
            outputType = types[types.length-1];
        }

        const aggregation = /^([a-zA-Z]+)\(([^)]+)\)$/.exec(outputType);
        if (aggregation !== null) {
            let operator;
            [, operator, outputType] = aggregation;

            const field = Object.keys(outputValue)[0];
            const value = outputValue[field];
            if (operator === 'count') {
                mappedResult[field] = Ast.Value.fromJS(Type.Number, outputValue[field]);
                return mappedResult;
            }

            const schema = await this._outputTypeToSchema(outputType);
            const type = schema.getArgType(field) || this._inferType(value);
            mappedResult[field] = Ast.Value.fromJS(type, value);
        } else {
            const schema = await this._outputTypeToSchema(outputType);

            for (let key in outputValue) {
                const value = outputValue[key];
                if (value === null || value === undefined)
                    continue;
                const type = schema.getArgType(key) || this._inferType(value);
                if (type.isCompound)
                    mappedResult[key] = this._mapCompound(key + '.', schema, value);
                else
                    mappedResult[key] = Ast.Value.fromJS(type, value);
            }
        }
        return mappedResult;
    }

    _mapCompound(prefix, schema, object) {
        let result = {};
        for (let key in object) {
            const value = object[key];
            const type = schema.getArgType(prefix + key) || this._inferType(value);
            if (type.isCompound)
                result[key] = this._mapCompound(prefix + key + '.', type, object);
            else
                result[key] = Ast.Value.fromJS(type, value);
        }
        return new Ast.Value.Object(result);
    }
}

/**
 * Simulate the execution of ThingTalk code.
 */
class ThingTalkStatementSimulator {
    constructor(options) {
        this._options = options;
        this.cache = new Map;
    }

    async executeStatement(stmt, execState) {
        assert(stmt instanceof Ast.Statement.Command || stmt instanceof Ast.Statement.Rule);

        if (stmt instanceof Ast.Statement.Rule) {
            // nothing to do, this always returns nothing
            return [[], execState];
        }

        if (execState === undefined)
            execState = new ThingTalkSimulatorState(this._options);

        // there is no way around this, we need to compile and run the program!
        const compiled = await execState.compile(stmt, this.cache);
        const resultList = await execState.simulate(stmt, compiled);
        return [resultList, execState];
    }
}
module.exports = ThingTalkStatementSimulator;
