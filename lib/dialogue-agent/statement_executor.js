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
const Type = ThingTalk.Type;

// above MORE_SIZE, we set the "more" bit
const MORE_SIZE = 50;
// above PAGE_SIZE, we set the count but don't actually show the full list of results
const PAGE_SIZE = 10;

/**
 * Run the dialogue, executing ThingTalk and invoking the policy at the
 * right time.
 */
class InferenceStatementExecutor {
    constructor(engine) {
        this._engine = engine;
        this._schemas = this._engine.schemas;
    }

    _inferType(key, jsValue) {
        if (key === 'distance') // HACK
            return new Type.Measure('m');
        if (typeof jsValue === 'boolean')
            return Type.Boolean;
        if (typeof jsValue === 'string')
            return Type.String;
        if (typeof jsValue === 'number')
            return Type.Number;
        if (jsValue instanceof ThingTalk.Builtin.Currency)
            return Type.Currency;
        if (jsValue instanceof ThingTalk.Builtin.Entity)
            return new Type.Entity('');
        if (jsValue instanceof ThingTalk.Builtin.Time)
            return Type.Time;
        if (jsValue instanceof Date)
            return Type.Date;
        if (Array.isArray(jsValue) && jsValue.length > 0)
            return new Type.Array(this._inferType(key, jsValue[0]));
        if (Array.isArray(jsValue))
            return new Type.Array(Type.Any);

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
                mappedResult[key] = Ast.Value.fromJS(this._inferType(key, jsValue), jsValue);
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
            const type = schema.getArgType(field) || this._inferType(field, value);
            mappedResult[field] = Ast.Value.fromJS(type, value);
        } else {
            const schema = await this._outputTypeToSchema(outputType);

            for (let key in outputValue) {
                const value = outputValue[key];
                const type = schema.getArgType(key) || this._inferType(key, value);

                if (value === null || value === undefined)
                    continue;

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

            if (value === null || value === undefined)
                continue;

            if (type.isCompound)
                result[key] = this._mapCompound(prefix + key + '.', type, object);
            else
                result[key] = Ast.Value.fromJS(type, value);
        }
        return new Ast.Value.Object(result);
    }

    async _iterateResults(app, into) {
        let count = 0;
        if (app === null)
            return [false, undefined, undefined];

        let errorCode, errorMessage;
        for await (const value of app.mainOutput) {
            if (count >= MORE_SIZE)
                return [true, errorCode, errorMessage];

            if (value instanceof Error) {
                if (value.code && typeof value.code === 'string'
                    && !value.code.startsWith('E')) // error codes starting with E are reserved for system errors
                    errorCode = value.code;
                if (!errorMessage)
                    errorMessage = value.message;
            } else {
                const raw = [value.outputType, value.outputValue];
                const mapped = await this._mapResult(value.outputType, value.outputValue);
                into.push(new Ast.DialogueHistoryResultItem(null, mapped, raw));
                count ++;
            }
        }

        // if we get here, we iterated all results from the app, so we can stop
        return [false, errorCode, errorMessage];
    }

    async executeStatement(stmt) {
        assert(stmt instanceof Ast.Statement.Command || stmt instanceof Ast.Statement.Rule);

        const program = new Ast.Program(null, [], [], [stmt]);
        const app = await this._engine.createApp(program);
        const results = [];
        const [more, errorCode, errorMessage] = await this._iterateResults(app, results);

        const resultList = new Ast.DialogueHistoryResultList(null, results.slice(0, PAGE_SIZE),
            new Ast.Value.Number(results.length), more,
            (errorCode ? new Ast.Value.Enum(errorCode) :
             (errorMessage ? new Ast.Value.String(errorMessage) : null)));
        return [resultList, undefined];
    }
}
module.exports = InferenceStatementExecutor;
