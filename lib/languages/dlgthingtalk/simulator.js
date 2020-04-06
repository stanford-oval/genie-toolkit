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

    async invokeAction(kind, attrs, fname, params) {
        const outputType = kind + ':action/' + fname;
        const schema = await this._schemas.getSchemaAndNames(kind, 'action', fname);

        // XXX for now, assume the action is always successful (on error, I'll modify the annotated.txt by hand)


        let anyOutArgument = false;
        for (let arg of schema.iterateArguments()) {
            if (!arg.is_input) {
                anyOutArgument = true;
                break;
            }
        }

        if (anyOutArgument) {
            const result = this.generator.generate(schema, params, 0);
            await this.output(outputType, result);
        }
    }

    async _doInvokeQuery(kind, fname, params) {
        const outputType = kind + ':' + fname;
        const schema = await this._schemas.getSchemaAndNames(kind, 'query', fname);
        if (this._database && this._database.has(outputType)) {
            const data = this._database.get(outputType);
            return [data.map((item) => {
                let mapped = {};
                for (let key in item) {
                    let value = item[key];
                    let arg = schema.getArgument(key);
                    if (arg && arg.type.isEntity && typeof value === 'object')
                        value = new ThingTalk.Entity(value.value, value.display);
                    else if (arg && arg.type.isLocation)
                        value = new ThingTalk.Location(value[0], value[1]);
                    mapped[key] = value;
                }

                return [outputType, mapped];
            }), true];
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
        this._database = options.database;

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

        try {
            const compiler = new ThingTalk.Compiler(this._schemas);

            compiled = await compiler.compileProgram(program);
            assert(compiled.rules.length === 0);
            this._compilationCache.set(cacheKey, compiled);
        } catch(e) {
            console.error(`Failed to compile program: ` + e.message);
            console.error(program.prettyprint());
            throw e;
        }
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

        // there is no way around this, we need to compile and run the program!
        const compiled = await this._compileStmt(stmt);

        if (execState === undefined)
            execState = new SimulationExecEnvironment(this._locale, this._schemas, this._database, this._rng);

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
