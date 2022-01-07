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
import { ImplementationError } from 'thingpedia';
import { Ast, Type } from 'thingtalk';

import type Engine from '../engine';
import type AppExecutor from '../engine/apps/app_executor';

import type {
    NewProgramRecord,
    RawExecutionResult,
    NotificationConfig,
} from './abstract_dialogue_agent';

// above MORE_SIZE, we set the "more" bit
const MORE_SIZE = 50;
// above PAGE_SIZE, we set the count but don't actually show the full list of results
const PAGE_SIZE = 10;

interface ErrorWithCode extends Error {
    code ?: unknown;
}

/**
 * Run the dialogue, executing ThingTalk and invoking the policy at the
 * right time.
 */
export default class InferenceStatementExecutor {
    private _engine : Engine;
    private _conversationId : string;

    constructor(engine : Engine, conversationId : string) {
        this._engine = engine;
        this._conversationId = conversationId;
    }

    private _getType(schema : Ast.FunctionDef, key : string) {
        if (key === '__device')
            return new Type.Entity('tt:device_id');
        const type = schema.getArgType(key);
        if (type)
            return type;
        if (key === 'distance') // HACK
            return new Type.Measure('m');
        return null;
    }

    private _mapValue(key : string, type : Type, value : unknown) {
        try {
            if (Number.isNaN(value) || (value instanceof Date && Number.isNaN(value.getTime())))
                throw new ImplementationError(`Invalid NaN value`);

            if (type instanceof Type.Enum && (typeof value !== 'string' || !type.entries!.includes(value)))
                throw new ImplementationError(`Invalid enum value`);

            return Ast.Value.fromJS(type, value);
        } catch(e) {
            console.error(`Failed to map result field ${key} to type ${type}`, e);
            return null;
        }
    }

    async mapResult(schema : Ast.FunctionDef, outputValue : Record<string, unknown>) {
        const mappedResult : Record<string, Ast.Value> = {};

        for (const key in outputValue) {
            const value = outputValue[key];
            if (value === null || value === undefined)
                continue;
            if (key === '__timestamp')
                continue;
            const type = this._getType(schema, key);
            if (!type) {
                console.error(`Thingpedia function returned undeclared field ${key}`);
                continue;
            }

            let mapped;
            if (type instanceof Type.Compound)
                mapped = this._mapCompound(key + '.', schema, value as Record<string, unknown>);
            else
                mapped = this._mapValue(key, type, value);
            if (mapped)
                mappedResult[key] = mapped;
        }
        return new Ast.DialogueHistoryResultItem(null, mappedResult, outputValue);
    }

    private _mapCompound(prefix : string, schema : Ast.FunctionDef, object : Record<string, unknown>) {
        const result : Record<string, Ast.Value> = {};
        for (const key in object) {
            const value = object[key];
            if (value === null || value === undefined)
                continue;
            const type = this._getType(schema, prefix + key);
            if (!type)
                continue;

            let mapped;
            if (type instanceof Type.Compound)
                mapped = this._mapCompound(prefix + key + '.', schema, object as Record<string, unknown>);
            else
                mapped = this._mapValue(prefix + key, type, value);
            if (mapped)
                result[key] = mapped;
        }
        return new Ast.Value.Object(result);
    }

    mapError(error : Error) : Ast.Value {
        const err : ErrorWithCode = error;
        if (typeof err.code === 'string')
            return new Ast.Value.Enum(err.code);
        return new Ast.Value.String(error.message);
    }

    private async _iterateResults(app : AppExecutor,
                                  schema : Ast.FunctionDef,
                                  into : Ast.DialogueHistoryResultItem[],
                                  intoRaw : RawExecutionResult) : Promise<[boolean, ErrorWithCode|undefined]> {
        let count = 0;
        if (app === null)
            return [false, undefined];

        let error : ErrorWithCode|undefined;
        for await (const value of app.mainOutput) {
            if (count >= MORE_SIZE)
                return [true, error];

            if (value instanceof Error) {
                error = value;
            } else {
                const mapped = await this.mapResult(schema, value.outputValue);
                into.push(mapped);
                intoRaw.push([value.outputType, value.outputValue]);
                count ++;
            }
        }

        // if we get here, we iterated all results from the app, so we can stop
        return [false, error];
    }

    async executeStatement(stmt : Ast.ExpressionStatement, privateState : undefined, notifications : NotificationConfig|undefined) : Promise<[Ast.DialogueHistoryResultList, RawExecutionResult, NewProgramRecord, undefined, Ast.AnnotationSpec]> {
        const program = new Ast.Program(null, [], [], [stmt]);
        const app = await this._engine.createApp(program, { notifications, conversation: this._conversationId });
        // by now the statement must have been typechecked
        assert(stmt.expression.schema);
        const results : Ast.DialogueHistoryResultItem[] = [];
        const rawResults : RawExecutionResult = [];
        const [more, error] = await this._iterateResults(app, stmt.expression.schema, results, rawResults);

        const annotations : Ast.AnnotationMap = {};
        let errorValue;
        if (error) {
            if (typeof error.code === 'number')
                errorValue = new Ast.Value.Enum(`http_${error.code}`);
            else if (typeof error.code === 'string' && error.code)
                errorValue = new Ast.Value.Enum(error.code);
            else
                errorValue = new Ast.Value.String(error.message);
            annotations.error_detail = new Ast.Value.String(error.message);
            if (error.stack)
                annotations.error_stack = new Ast.Value.String(error.stack);
        }

        const resultList = new Ast.DialogueHistoryResultList(null, results.slice(0, PAGE_SIZE),
            new Ast.Value.Number(results.length), more, errorValue);
        const newProgramRecord = {
            uniqueId: app.uniqueId!,
            name: app.name,
            code: program.prettyprint(),
            results: rawResults.map((r) => r[1]),
            errors: errorValue ? [errorValue.toJS()] : [],
            icon: app.icon,
        };
        return [resultList, rawResults, newProgramRecord, undefined, { impl: annotations }];
    }
}
