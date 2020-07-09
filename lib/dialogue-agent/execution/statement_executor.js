// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
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

// above MORE_SIZE, we set the "more" bit
const MORE_SIZE = 50;
// above PAGE_SIZE, we set the count but don't actually show the full list of results
const PAGE_SIZE = 10;

/**
 * Run the dialogue, executing ThingTalk and invoking the policy at the
 * right time.
 */
class InferenceStatementExecutor {
    constructor(dispatcher) {
        this._dispatcher = dispatcher;
        this._engine = dispatcher.engine;
        this._schemas = this._engine.schemas;
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

    async executeStatement(stmt) {
        assert(stmt instanceof Ast.Statement.Command || stmt instanceof Ast.Statement.Rule);

        const program = new Ast.Program(null, [], [], [stmt]);
        const app = await this._engine.createApp(program);
        const results = [];
        let more = false;
        await app.runCommand({
            output: async (outputType, outputValue) => {
                if (results.length >= MORE_SIZE) {
                    more = true;
                    return false;
                }
                const raw = [outputType, outputValue];
                const mapped = await this._mapResult(outputType, outputValue);
                results.push(new Ast.DialogueHistoryResultItem(null, mapped, raw));
                return results.length < MORE_SIZE;
            },

            notifyError(error) {
                console.error(`FIXME: unhandled error from ThingTalk`, error);
            }
        });

        const resultList = new Ast.DialogueHistoryResultList(null, results.slice(0, PAGE_SIZE),
            new Ast.Value.Number(results.length), more);
        return [resultList, undefined];
    }
}
module.exports = InferenceStatementExecutor;
