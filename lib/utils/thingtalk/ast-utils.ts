// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020-2021 The Board of Trustees of the Leland Stanford Junior University
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

export interface ErrorWithCode extends Error {
    code ?: string;
}

export function mapError(error : Error) : Ast.Value {
    const err : ErrorWithCode = error;
    if (typeof err.code === 'string') // error codes starting with E are reserved for system errors
        return new Ast.Value.Enum(err.code);
    return new Ast.Value.String(error.message);
}


function sortByName(p1 : Ast.InputParam, p2 : Ast.InputParam) : -1|0|1 {
    if (p1.name < p2.name)
        return -1;
    if (p1.name > p2.name)
        return 1;
    return 0;
}

/**
 * Sets the named input parameter to the given value.
 *
 * If the parameter is already present in the invocation, it is overwritten.
 * Otherwise, a new parameter is added.
 *
 * The invocation is modified in place.
 *
 * @param invocation
 * @param pname
 * @param value
 */
export function setOrAddInvocationParam(invocation : Ast.Invocation,
                                        pname : string,
                                        value : Ast.Value) : void {
    let found = false;
    for (const in_param of invocation.in_params) {
        if (in_param.name === pname) {
            found = true;
            in_param.value = value;
            break;
        }
    }
    if (!found) {
        invocation.in_params.push(new Ast.InputParam(null, pname, value));
        invocation.in_params.sort(sortByName);
    }
}

/**
 * Merge the input parameters of `fromInvocation` into those of `toInvocation`,
 * overriding any parameter with the same name that is already present.
 *
 * `toInvocation` is modified in place.
 *
 * @param toInvocation
 * @param fromInvocation
 * @returns `toInvocation`
 */
export function mergeParameters(toInvocation : Ast.Invocation,
                                fromInvocation : Ast.Invocation) : Ast.Invocation {
    for (const in_param of fromInvocation.in_params) {
        if (in_param.value.isUndefined)
            continue;
        setOrAddInvocationParam(toInvocation, in_param.name, in_param.value);
    }

    return toInvocation;
}


class AdjustDefaultParametersVisitor extends Ast.NodeVisitor {
    visitInvocation(invocation : Ast.Invocation) : boolean {
        invocation.in_params = invocation.in_params.filter((ip) => {
            const arg = invocation.schema!.getArgument(ip.name);
            assert(arg && arg.is_input);
            const _default = arg.impl_annotations.default;
            if (_default && ip.value.equals(_default))
                return false;
            return true;
        });
        return false;
    }
}

/**
 * Adjust input parameters in all invocations of this Ast node so
 * optional parameters that have their default value are omitted.
 *
 * @param stmt
 * @returns
 */
export function adjustDefaultParameters<T extends Ast.Node>(stmt : T) : T {
    stmt.visit(new AdjustDefaultParametersVisitor());
    return stmt;
}
