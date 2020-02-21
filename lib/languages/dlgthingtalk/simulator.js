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

const AbstractThingTalkExecutor = require('./executor');

const { coin, uniform, randint } = require('../../random');

/*
function getApproximateResultSize(table, rng) {
    assert(rng);
    if (table.isProjection || table.isSort || table.isCompute)
        return getApproximateResultSize(table.table, rng);
    if (table.isIndex)
        return table.index.length;
    if (table.isSlice)
        return table.limit.isNumber ? table.limit.value : randint(10, 20, rng);
    if (table.isAggregation)
        return 1;
    if (table.isInvocation)
        return randint(500, 5000, rng);
    if (table.isFilter) {
        if (table.filter.isAnd) {
            for (let clause of table.filter.operands) {
                if (clause.isAtom && clause.name === 'id')
                    return 1;
            }
        }
        if (table.filter.isAtom && table.filter.name === 'id')
            return 1;
        let numClauses = table.filter.isAnd ? table.filter.operands.length : 1;
        return Math.ceil(getApproximateResultSize(table.table, rng) * Math.pow(0.2, numClauses));
    }
    if (table.isJoin)
        return getApproximateResultSize(table.lhs, rng) * getApproximateResultSize(table.rhs, rng);

    throw new TypeError();
}
*/

class ResultGenerator {
    constructor(rng) {
        this._rng = rng;

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
            if (arg.type.isCompound)
                continue;
            if (arg.direction !== Ast.ArgDirection.OUT)
                continue;

            if (arg.name === 'id')
                result[arg.name] = new ThingTalk.Builtin.Entity(`str:ENTITY_${arg.type.type}::${index}:`, null);
            else
                result[arg.name] = this._generateValue(arg.type, arg.name !== 'id', arg);
        }
        return result;
    }

    _generateValue(type, repeatable = true, arg) {
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
        return new Date(2018, 0, this._generateNumber('DATE', repeatable));
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

class SimulationExecEnvironment extends ThingTalk.ExecEnvironment {
    constructor(locale, schemas, rng, output) {
        super(locale, 'America/Los_Angeles', schemas);
        this._execCache = [];

        this._rng = rng;
        this._schemas = schemas;

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

    async _doInvokeQuery(kind, fname, params) {
        const schema = await this._schemas.getSchemaAndNames(kind, 'query', fname);

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
        const outputType = kind + ':' + fname;

        let results = [];
        for (let i = 0; i < numResults; i++)
            results.push([outputType, this.generator.generate(schema, params, i)]);

        return [results, cacheable];
    }

    async invokeQuery(kind, attrs, fname, params) {
        const functionKey = kind + ':' + fname;
        const cached = this._findInCache(functionKey, params);
        if (cached)
            return Promise.resolve(cached);

        const [list, cacheable] = await this._doInvokeQuery(kind, fname, params);
        if (cacheable)
            this._execCache.push([functionKey, params, list]);
        return list;
    }

    async reportError(msg, error) {
        console.error(msg, error);
        process.exit(1);
    }
}

// above MORE_SIZE, we set the "more" bit
const MORE_SIZE = 50;
// above PAGE_SIZE, we set the count but don't actually show the full list of results
const PAGE_SIZE = 10;

/**
 * Simulate the execution of ThingTalk code.
 */
class ThingTalkSimulator extends AbstractThingTalkExecutor {
    constructor(options) {
        super();
        this._locale = options.locale;
        this._schemas = options.schemaRetriever;
        this._rng = options.rng;

        this._compilationCache = new Map;
    }

    async _compileStmt(stmt) {
        const clone = stmt.clone();

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
                assert(value.isConcrete());
                return true;
            }
        });

        const program = new Ast.Program(null, [], [], [clone]);
        const cacheKey = program.prettyprint();
        //console.error(cacheKey);

        let compiled = this._compilationCache.get(cacheKey);
        if (compiled)
            return compiled;

        const compiler = new ThingTalk.Compiler(this._schemas);

        compiled = await compiler.compileProgram(program);
        assert(compiled.rules.length === 0);
        this._compilationCache.set(cacheKey, compiled);
        return compiled;
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

            const [kind, fname] = outputType.split(':');
            const schema = await this._schemas.getSchemaAndNames(kind, 'query', fname);

            const type = schema.getArgType(fname) || this._inferType(value);
            mappedResult[field] = Ast.Value.fromJS(type, value);
        } else {
            const [kind, fname] = outputType.split(':');
            const schema = await this._schemas.getSchemaAndNames(kind, 'query', fname);

            for (let key in outputValue) {
                const value = outputValue[key];
                const type = schema.getArgType(key) || this._inferType(value);
                mappedResult[key] = Ast.Value.fromJS(type, value);
            }
        }
        return mappedResult;
    }

    async executeStatement(stmt, execState) {
        assert(stmt instanceof Ast.Statement.Command || stmt instanceof Ast.Statement.Rule);

        if (stmt instanceof Ast.Statement.Rule) {
            // nothing to do, this always returns nothing
            return [[], execState];
        }

        if (stmt.actions.length > 0 && !stmt.actions.some((a) => a.isNotify)) {
            // FIXME for now, actions return nothing
            return [[], execState];
        }
        assert(stmt.table);

        // there is no way around this, we need to compile and run the program!
        const compiled = await this._compileStmt(stmt);

        /*
        let numResults;
        if (stmt.table.schema.is_list)
            numResults = getApproximateResultSize(stmt.table, this._rng);
        else
            numResults = 1;
        */

        if (execState === undefined)
            execState = new SimulationExecEnvironment(this._locale, this._schemas, this._rng);

        const results = [];
        const generator = new ResultGenerator(this._rng);
        for (let slot of stmt.iterateSlots2()) {
            if (slot instanceof Ast.Selector)
                continue;
            generator.addCandidate(slot.get());
        }
        execState.generator = generator;
        execState.output = async (outputType, outputValue) => {
            const mapped = await this._mapResult(outputType, outputValue);
            results.push(new Ast.DialogueHistoryResultItem(null, mapped));
        };

        await compiled.command(execState);

        const numResults = results.length;
        const resultList = new Ast.DialogueHistoryResultList(null, results.slice(0, PAGE_SIZE),
            new Ast.Value.Number(Math.min(MORE_SIZE, numResults)), numResults > MORE_SIZE);

        return [resultList, execState];
    }
}
module.exports = ThingTalkSimulator;
