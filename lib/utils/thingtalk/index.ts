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
import { Ast, Builtin, Type, } from 'thingtalk';

import { extractConstants, createConstants } from './constants';
export * from './describe';
export * from './syntax';
export * from './dialogue_state_utils';
// reexport clean, tokenizeExample from misc-utils
import { clean, tokenizeExample } from '../misc-utils';
import { PolicyModule } from '../../thingtalk-dialogues';

export { clean, tokenizeExample };

export {
    extractConstants,
    createConstants,
};

function validateState(state : Ast.DialogueState, forTarget : 'user'|'agent') : void {
    if (forTarget === 'user') {
        // check that there are no 'proposed' items
        // (should be executed, 'accepted' or 'confirmed')
        for (const item of state.history)
            assert(item.confirm !== 'proposed');
    } else {
        // check that there are no 'confirmed' items that were not executed
        // TODO: if we add "intermediate_context" capabilities to the state machine
        // we can relax this restriction
        for (const item of state.history)
            assert(item.confirm !== 'confirmed' || item.results !== null);
    }
}

/**
 * A faster version of PolicyManifest that uses sets instead of arrays.
 */
interface SetPolicyManifest {
    name : string;
    terminalAct : string;
    dialogueActs : {
        user : Set<string>;
        agent : Set<string>;
        withParam : Set<string>;
    };
}
type PolicyManifest = PolicyModule['MANIFEST'];

export class StateValidator {
    private _policy : SetPolicyManifest;

    constructor(policy : PolicyManifest) {
        this._policy = {
            name: policy.name,
            terminalAct: policy.terminalAct,
            dialogueActs: {
                user: new Set(policy.dialogueActs.user),
                agent: new Set(policy.dialogueActs.agent),
                withParam: new Set(policy.dialogueActs.withParam)
            }
        };
    }

    validateUser(state : Ast.DialogueState) : void {
        validateState(state, 'user');

        if (!this._policy)
            return;
        assert.strictEqual(state.policy, this._policy.name);
        assert(this._policy.dialogueActs.user.has(state.dialogueAct), `Invalid user dialogue act ${state.dialogueAct}`);
        // if and only if
        assert((state.dialogueActParam !== null) === (this._policy.dialogueActs.withParam.has(state.dialogueAct)));
    }

    validateAgent(state : Ast.DialogueState) : void {
        validateState(state, 'agent');

        if (!this._policy)
            return;
        assert.strictEqual(state.policy, this._policy.name);
        assert(this._policy.dialogueActs.agent.has(state.dialogueAct), `Invalid agent dialogue act ${state.dialogueAct}`);
        // if and only if
        assert((state.dialogueActParam !== null) === (this._policy.dialogueActs.withParam.has(state.dialogueAct)));
    }
}

class UsesParamVisitor extends Ast.NodeVisitor {
    used = false;
    constructor(private pname : string) {
        super();
    }

    visitExternalBooleanExpression() {
        // do not recurse
        return false;
    }
    visitValue() {
        // do not recurse
        return false;
    }

    visitAtomBooleanExpression(atom : Ast.AtomBooleanExpression) {
        this.used = this.used ||
            (this.pname === atom.name && atom.operator === '=~');
        return true;
    }
}

export function expressionUsesIDFilter(expr : Ast.Expression) {
    const visitor = new UsesParamVisitor('id');
    expr.visit(visitor);
    return visitor.used;
}

export function addIndexToIDQuery(stmt : Ast.ExpressionStatement) {
    // we add the clause to all expressions except the last one
    // that way, if we have an action, it will be performed on the first
    // result only, but if we don't have an action, we'll return all results
    // that match
    //
    // we go inside projection/monitor expressions, and skip entirely expressions that
    // have existing sort/index/slice/aggregate

    for (let i = 0; i < stmt.expression.expressions.length-1; i++) {
        let expr = stmt.expression.expressions[i];

        // use a lens pattern to write the newly created expression in the right place
        // as we traverse the AST down
        let lens = (expr : Ast.Expression) => {
            stmt.expression.expressions[i] = expr;
        };
        if (expr.schema!.functionType !== 'action' &&
            expr.schema!.is_list &&
            expressionUsesIDFilter(expr)) {
            while (expr instanceof Ast.MonitorExpression ||
                expr instanceof Ast.ProjectionExpression ||
                // also recurse into edge filters (filters of monitors)
                (expr instanceof Ast.FilterExpression &&
                 expr.expression instanceof Ast.MonitorExpression)) {
                const parent = expr;
                lens = (expr : Ast.Expression) => {
                    parent.expression = expr;
                };
                expr = parent.expression;
            }
            if (expr instanceof Ast.IndexExpression || expr instanceof Ast.SliceExpression ||
                expr instanceof Ast.SortExpression || expr instanceof Ast.AggregationExpression)
                continue;

            lens(new Ast.IndexExpression(null, expr, [new Ast.Value.Number(1)], expr.schema).optimize());
        }
    }
}

function inferType(key : string, jsValue : unknown) : Type {
    if (key === 'distance') // HACK
        return new Type.Measure('m');
    if (key === '__device')
        return new Type.Entity('tt:device_id');
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
        return new Type.Array(inferType(key, jsValue[0]));
    if (Array.isArray(jsValue))
        return new Type.Array(Type.Any);

    return Type.Any;
}

export async function mapResult(schema : Ast.FunctionDef, outputValue : Record<string, unknown>) {
    const mappedResult : Record<string, Ast.Value> = {};

    for (const key in outputValue) {
        const value = outputValue[key];
        const type = schema.getArgType(key) || inferType(key, value);

        if (value === null || value === undefined)
            continue;

        if (type instanceof Type.Compound)
            mappedResult[key] = mapCompound(key + '.', schema, value as Record<string, unknown>);
        else
            mappedResult[key] = Ast.Value.fromJS(type, value);
    }
    return new Ast.DialogueHistoryResultItem(null, mappedResult, outputValue);
}

function mapCompound(prefix : string, schema : Ast.FunctionDef, object : Record<string, unknown>) {
    const result : Record<string, Ast.Value> = {};
    for (const key in object) {
        const value = object[key];
        const type = schema.getArgType(prefix + key) || inferType(prefix + key, value);

        if (value === null || value === undefined)
            continue;

        if (type instanceof Type.Compound)
            result[key] = mapCompound(prefix + key + '.', schema, object as Record<string, unknown>);
        else
            result[key] = Ast.Value.fromJS(type, value);
    }
    return new Ast.Value.Object(result);
}

export interface ErrorWithCode {
    message : string;
    code ?: string;
}

export function mapError(error : Error) : Ast.Value {
    const err : ErrorWithCode = error;
    if (typeof err.code === 'string') // error codes starting with E are reserved for system errors
        return new Ast.Value.Enum(err.code);
    return new Ast.Value.String(error.message);
}
