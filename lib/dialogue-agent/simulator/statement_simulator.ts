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

import {
    Ast,
    Type,
    Compiler,
    SchemaRetriever,
    CompiledProgram,
    Builtin
} from 'thingtalk';

import {
    ResultGenerator,
    SimulationExecEnvironment,
    SimulatedError
} from './simulation_exec_environment';
import { SimulationDatabase } from './types';

// above MORE_SIZE, we set the "more" bit
const MORE_SIZE = 50;
// above PAGE_SIZE, we set the count but don't actually show the full list of results
const PAGE_SIZE = 10;

interface SimulatorOptions {
    locale : string;
    timezone : string|undefined;
    schemaRetriever : SchemaRetriever;
    rng : () => number;
    database ?: SimulationDatabase;
    overrides ?: Map<string, string>;
}

type RawExecutionResult = Array<[string, Record<string, unknown>]>;
type ExecutionResult = [Ast.DialogueHistoryResultList, RawExecutionResult];

export class ThingTalkSimulatorState {
    private _locale : string;
    private _schemas : SchemaRetriever;
    private _rng : () => number;
    private _database : SimulationDatabase|undefined;
    private _overrides : Map<string, string>;
    private _execEnv : SimulationExecEnvironment;

    constructor(options : SimulatorOptions) {
        this._locale = options.locale;
        this._schemas = options.schemaRetriever;
        this._rng = options.rng;
        this._database = options.database;
        this._overrides = options.overrides || new Map;

        this._execEnv = new SimulationExecEnvironment(this._locale, options.timezone, this._schemas, this._database, {
            rng: this._rng
        });
    }

     async compile(stmt : Ast.ExpressionStatement, cache : Map<string, CompiledProgram>) : Promise<CompiledProgram> {
        const clone = stmt.clone();

        const program = new Ast.Program(null, [], [], [clone]);
        const cacheKey = program.prettyprint();
        //console.error(cacheKey);

        let compiled = cache.get(cacheKey);
        if (compiled)
            return compiled;

        try {
            const compiler = new Compiler(this._schemas);

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

    async simulate(stmt : Ast.ExpressionStatement, compiled : CompiledProgram) : Promise<ExecutionResult> {
        const results : Ast.DialogueHistoryResultItem[] = [];
        const rawResults : RawExecutionResult = [];
        let error : Ast.Value|null = null;
        const generator = new ResultGenerator(this._rng, this._overrides);
        for (const slot of stmt.iterateSlots2()) {
            if (slot instanceof Ast.DeviceSelector)
                continue;
            generator.addCandidate(slot.get());
        }
        this._execEnv.generator = generator;
        this._execEnv.output = async (outputType : string, outputValue : { [key : string] : unknown }) => {
            const mapped = new Ast.DialogueHistoryResultItem(null, await this._mapResult(outputType, outputValue));
            results.push(mapped);
            rawResults.push([outputType, outputValue]);
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
            assert(typeof compiled.command === 'function');
            await compiled.command(this._execEnv);
        } catch(e) {
            console.error(`Failed to execute program: ` + e.message);
            console.error(new Ast.Program(null, [], [], [stmt]).prettyprint());
            throw e;
        }

        const numResults = results.length;
        return [new Ast.DialogueHistoryResultList(null, results.slice(0, PAGE_SIZE),
            new Ast.Value.Number(Math.min(MORE_SIZE, numResults)), numResults > MORE_SIZE, error), rawResults];
    }

    private _inferType(jsValue : unknown) : Type {
        if (typeof jsValue === 'boolean')
            return Type.Boolean;
        if (typeof jsValue === 'string')
            return Type.String;
        if (typeof jsValue === 'number')
            return Type.Number;
        if (jsValue instanceof Builtin.Currency)
            return Type.Currency;
        if (jsValue instanceof Builtin.Entity)
            return new Type.Entity('');
        if (jsValue instanceof Builtin.Time)
            return Type.Time;
        if (jsValue instanceof Date)
            return Type.Date;
        if (Array.isArray(jsValue) && jsValue.length > 0)
            return new Type.Array(this._inferType(jsValue[0]));
        if (Array.isArray(jsValue))
            return new Type.Array(Type.Any);

        return Type.Any;
    }

    private _outputTypeToSchema(outputType : string) : Promise<Ast.FunctionDef> {
        const [kind, fname] = outputType.split(':');
        let ftype : 'query'|'action' = 'query';

        let fname_ = fname;
        if (fname_.startsWith('action/')) {
            ftype = 'action';
            fname_ = fname_.substring('action/'.length);
        }
        return this._schemas.getSchemaAndNames(kind, ftype, fname_);
    }

    private async _mapResult(outputType : string|null, outputValue : { [key : string] : unknown }) : Promise<{ [key : string] : Ast.Value }> {
        const mappedResult : { [key : string] : Ast.Value } = {};
        if (outputType === null) {
            // fallback
            for (const key in outputValue) {
                const jsValue = outputValue[key];
                mappedResult[key] = Ast.Value.fromJS(this._inferType(jsValue), jsValue);
            }
            return mappedResult;
        }

        if (outputType.indexOf('+') >= 0) {
            const types = outputType.split('+');
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

            for (const key in outputValue) {
                const value = outputValue[key];
                if (value === null || value === undefined)
                    continue;
                const type = schema.getArgType(key) || this._inferType(value);
                if (type instanceof Type.Compound)
                    mappedResult[key] = this._mapCompound(key + '.', schema, value as { [key : string] : unknown });
                else
                    mappedResult[key] = Ast.Value.fromJS(type, value);
            }
        }
        return mappedResult;
    }

    private _mapCompound(prefix : string, schema : Ast.FunctionDef, object : { [key : string] : unknown }) : Ast.Value {
        const result : { [key : string] : Ast.Value } = {};
        for (const key in object) {
            const value = object[key];
            const type = schema.getArgType(prefix + key) || this._inferType(value);
            if (type instanceof Type.Compound)
                result[key] = this._mapCompound(prefix + key + '.', schema, object as { [key : string] : unknown });
            else
                result[key] = Ast.Value.fromJS(type, value);
        }
        return new Ast.Value.Object(result);
    }
}

/**
 * Simulate the execution of ThingTalk code.
 */
export default class ThingTalkStatementSimulator {
    private _options : SimulatorOptions;
    private cache : Map<string, CompiledProgram>;

    constructor(options : SimulatorOptions) {
        this._options = options;
        this.cache = new Map;
    }

    async executeStatement(stmt : Ast.ExpressionStatement,
                           execState : ThingTalkSimulatorState) : Promise<[Ast.DialogueHistoryResultList, RawExecutionResult, undefined, ThingTalkSimulatorState]> {
        if (stmt.stream) {
            // nothing to do, this always returns nothing
            return [new Ast.DialogueHistoryResultList(null, [],
                new Ast.Value.Number(0), false, null), [], undefined, execState];
        }

        if (execState === undefined)
            execState = new ThingTalkSimulatorState(this._options);

        // there is no way around this, we need to compile and run the program!
        const compiled = await execState.compile(stmt, this.cache);
        const [resultList, rawResults] = await execState.simulate(stmt, compiled);
        // ignore the new program record, it doesn't matter at simulation time
        return [resultList, rawResults, undefined, execState];
    }
}
