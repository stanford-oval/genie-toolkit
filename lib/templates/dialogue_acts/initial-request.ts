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

import { Ast, Type } from 'thingtalk';

import * as C from '../ast_manip';
import ThingpediaLoader from '../load-thingpedia';

import {
    ContextInfo,
    addNewItem,
} from '../state_manip';
import {
    findOrMakeFilterExpression
} from './refinement-helpers';

function adjustStatementsForInitialRequest(loader : ThingpediaLoader,
                                           expr : Ast.ChainExpression) {
    if (!C.checkValidQuery(expr))
        return null;

    // if we have a stream, we apply no further modification to the statements,
    // regardless of #[confirm] parameter
    if (expr.first.schema!.functionType === 'stream')
        return [C.adjustDefaultParameters(new Ast.ExpressionStatement(null, expr))];

    const newStatements : Ast.ExpressionStatement[] = [];
    if (expr.expressions.length > 1) {
        // query + action
        // split into two statements, one getting the data, and the other using it

        assert(expr.expressions.length === 2);
        const table = expr.expressions[0];
        const action = expr.expressions[1];
        assert(action instanceof Ast.InvocationExpression);
        const confirm = loader.ttUtils.normalizeConfirmAnnotation(action.invocation.schema!);

        if (confirm === 'auto') {
            const compoundStmt = new Ast.ExpressionStatement(null, expr);
            newStatements.push(compoundStmt);
        } else {
            const queryStmt = new Ast.ExpressionStatement(null, table);
            newStatements.push(queryStmt);

            const newAction = action.clone();
            const in_params = newAction.invocation.in_params;
            for (const in_param of in_params) {
                if (in_param.value instanceof Ast.EventValue) // TODO
                    return null;
                if (!(in_param.value instanceof Ast.VarRefValue))
                    continue;
                if (in_param.value.name.startsWith('__const_'))
                    continue;

                // TODO: parameter passing for non ID parameter
                if (in_param.value.name !== 'id')
                    return null;

                // parameter passing
                // FIXME we need a new ThingTalk value type...
                in_param.value = new Ast.Value.Undefined(true);
            }
            const actionStmt = new Ast.ExpressionStatement(null, newAction);
            newStatements.push(actionStmt);
        }
    } else if (expr.first.schema!.functionType === 'action') {
        // action only
        // add a query, if the action refers to an ID entity

        const action = expr.first;
        assert(action instanceof Ast.InvocationExpression);

        // for "confirm=auto", the query is added to a compound command
        // and for "confirm=display_result", the query is added as a separate statement
        // this is necessary to be consistent and avoid ambiguity between
        // "play some song" (empty parameter) and "play songs" (parameter replaced with bare table)
        //
        // so for example, "book some restaurant" becomes
        // ```
        // $dialogue @org.thingpedia.dialogue.transaction.execute;
        // now => @uk.ac.cam.multiwoz.Restaurant.Restaurant() => notify;
        // now => @uk.ac.cam.multiwoz.Restaurant.make_booking() => notify;
        // ```
        //
        // and "play some song" becomes:
        // ```
        // $dialogue @org.thingpedia.dialogue.transaction.execute;
        // now => @com.spotify.song() => @com.spotify.play_song(song=id);
        // ```

        // first, check that we did not already have an entity parameter
        // (we need to reject that)

        let hasIDArg = false;
        for (const param of action.invocation.in_params) {
            const type = action.invocation.schema!.getArgType(param.name);
            if (!(type instanceof Type.Entity) || !loader.idQueries.has(type.type))
                continue;
            hasIDArg = true;
            if (param.value.isEntity)
                return null;
        }
        if (!hasIDArg) {
            newStatements.push(new Ast.ExpressionStatement(null, expr));
            return newStatements.map(C.adjustDefaultParameters);
        }

        const confirm = loader.ttUtils.normalizeConfirmAnnotation(action.invocation.schema!);
        const clone = action.clone();

        let newTable : Ast.Expression|null = null;
        for (const param of clone.invocation.in_params) {
            const type = clone.invocation.schema!.getArgType(param.name);
            if (!(type instanceof Type.Entity) || !loader.idQueries.has(type.type))
                continue;
            assert(param.value.isUndefined);

            // this assertion will fire if there are two entity parameters of
            // ID type in the same action
            assert(newTable === null);

            const query = loader.idQueries.get(type.type)!;
            newTable = new Ast.InvocationExpression(null,
                    new Ast.Invocation(null,
                        new Ast.DeviceSelector(null, query.class!.name, null, null),
                        query.name,
                        [],
                        query),
                    query);

            if (confirm === 'auto')
                param.value = new Ast.Value.VarRef('id');
        }
        assert(newTable);

        if (confirm === 'auto') {
            newStatements.push(new Ast.ExpressionStatement(null, new Ast.ChainExpression(null, [newTable, clone], clone.schema)));
        } else {
            newStatements.push(new Ast.ExpressionStatement(null, newTable));
            newStatements.push(new Ast.ExpressionStatement(null, clone));
        }
    } else {
        newStatements.push(new Ast.ExpressionStatement(null, expr));
    }

    return newStatements.map(C.adjustDefaultParameters);
}

function initialRequest(loader : ThingpediaLoader, stmt : Ast.Expression) {
    const newStatements = adjustStatementsForInitialRequest(loader, C.toChainExpression(stmt));
    if (newStatements === null)
        return null;

    const history = newStatements.map((stmt) => new Ast.DialogueHistoryItem(null, stmt, null, 'accepted'));
    return new Ast.DialogueState(null, 'org.thingpedia.dialogue.transaction', 'execute', null, history);
}

function getStatementDevice(stmt : Ast.ChainExpression) {
    return stmt.last.schema!.class!.name;
}

function startNewRequest(loader : ThingpediaLoader, ctx : ContextInfo, expr : Ast.Expression) {
    const stmt = C.toChainExpression(expr);

    if (loader.flags.strict_multidomain && ctx.current && getStatementDevice(ctx.current.stmt.expression) === getStatementDevice(stmt))
        return null;

    const newStatements = adjustStatementsForInitialRequest(loader, stmt);
    if (newStatements === null)
        return null;

    const newItems = newStatements.map((stmt) => new Ast.DialogueHistoryItem(null, stmt, null, 'accepted'));
    return addNewItem(ctx, 'execute', null, 'accepted', ...newItems);
}

function addInitialDontCare(expr : Ast.Expression, dontcare : C.FilterSlot) : Ast.Expression|null {
    const chain = C.toChainExpression(expr);
    const table = chain.lastQuery;
    if (!table)
        return null;
    if (!C.isSameFunction(table.schema!, dontcare.schema))
        return null;

    assert(dontcare.ast instanceof Ast.DontCareBooleanExpression);
    const arg = table.schema!.getArgument(dontcare.ast.name);
    if (!arg || arg.is_input)
        return null;
    if (arg.getAnnotation<boolean>('filterable') === false)
        return null;
    if (!table.schema!.is_list)
        return null;

    const clone = chain.clone();
    const filterExpression = findOrMakeFilterExpression(clone);
    assert(filterExpression);
    if (!(filterExpression.expression instanceof Ast.InvocationExpression))
        return null;

    if (C.filterUsesParam(filterExpression.filter, dontcare.ast.name))
        return null;

    filterExpression.filter = new Ast.BooleanExpression.And(null, [filterExpression.filter, dontcare.ast]).optimize();
    return clone;
}

export {
    initialRequest,
    startNewRequest,
    addInitialDontCare
};
