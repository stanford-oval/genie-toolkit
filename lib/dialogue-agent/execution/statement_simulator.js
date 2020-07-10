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

const { collectDisambiguationHints, getBestEntityMatch } = require('../entity-linking/entity-finder');
const {
    ResultGenerator,
    SimulationExecEnvironment,
    SimulatedError
} = require('./simulation_exec_environment');

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

        this._execEnv = new SimulationExecEnvironment(this._locale, this._schemas, this._database, {
            rng: this._rng
        });
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
                    const resolved = getBestEntityMatch(value.display, value.type,
                        previousIdEntities.get(value.type) || []);
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
