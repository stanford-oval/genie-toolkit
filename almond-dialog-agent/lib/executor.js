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

const { isExecutable, shouldAutoConfirmStatement } = require('./dialogue_state_utils');

/**
 * Run the dialogue, executing ThingTalk and invoking the policy at the
 * right time.
 */
class ThingTalkExecutor {
    constructor(dispatcher) {
        this._dispatcher = dispatcher;
        this._engine = dispatcher.engine;
        this._schemas = this._engine.schemas;
    }

    /**
     * Execute the query or action implied by the current dialogue state.
     *
     * This method should modify the state in-place.
     *
     * @param {Ast.DialogueState} state - the current state, representing the query or action to execute
     */
    async executeState(state) {
        for (let i = 0; i < state.history.length; i++) {
            if (state.history[i].results !== null)
                continue;
            if (state.history[i].confirm === 'accepted' &&
                isExecutable(state.history[i].stmt) &&
                shouldAutoConfirmStatement(state.history[i].stmt))
                state.history[i].confirm = 'confirmed';

            if (state.history[i].confirm !== 'confirmed')
                continue;
            assert(isExecutable(state.history[i].stmt));

            state.history[i].results = await this._executeStatement(state.history[i].stmt);
        }
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

    async _iterateResults(app, into) {
        let count = 0;
        if (app === null)
            return false;

        for (;;) {
            let { item: next, resolve } = await app.mainOutput.next();
            if (next.isQuestion)
                throw new Error('not implemented: questions from inside ThingTalk code');

            // resolve immediately so that the program can continue and
            // push the next result in the `app.mainOutput` queue
            resolve();
            if (next.isDone)
                break;

            if (count >= MORE_SIZE)
                return true;

            if (next.isNotification) {
                const raw = [next.outputType, next.outputValue];
                const mapped = await this._mapResult(next.outputType, next.outputValue);
                into.push(new Ast.DialogueHistoryResultItem(null, mapped, raw));
                count ++;
            } else if (next.isError) {
                console.error(`FIXME: unhandled error from ThingTalk`, next.error);
            }
        }

        // if we get here, we iterated all results from the app, so we can stop
        return false;
    }

    async _executeStatement(stmt) {
        assert(stmt instanceof Ast.Statement.Command || stmt instanceof Ast.Statement.Rule);

        const program = new Ast.Program(null, [], [], [stmt]);
        const app = await this._engine.createApp(program);

        const results = [];
        const more = await this._iterateResults(app, results);
        const resultList = new Ast.DialogueHistoryResultList(null, results.slice(0, PAGE_SIZE),
            new Ast.Value.Number(results.length), more);
        return resultList;
    }
}
module.exports = ThingTalkExecutor;
