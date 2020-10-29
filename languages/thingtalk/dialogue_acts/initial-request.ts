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
import _loader from '../load-thingpedia';

import {
    ContextInfo,
    addNewItem,
} from '../state_manip';
import {
    findOrMakeFilterTable
} from './refinement-helpers';

function tableUsesIDFilter(table : Ast.Table) {
    const filterTable = C.findFilterTable(table);
    if (!filterTable)
        return false;

    return C.filterUsesParam(filterTable.filter, 'id');
}

function adjustStatementsForInitialRequest(stmt : Ast.ExecutableStatement) {
    // TODO implement rules (streams)
    if (!(stmt instanceof Ast.Command))
        return null;

    if (stmt.table && !C.checkValidQuery(stmt.table))
        return null;

    const newStatements : Ast.Command[] = [];
    if (stmt.table && stmt.actions.some((a) => !a.isNotify)) {
        // query + action
        // split into two statements, one getting the data, and the other using it

        assert(stmt.actions.length === 1);
        const action = stmt.actions[0];
        assert(action instanceof Ast.InvocationAction);
        assert(action.invocation.selector instanceof Ast.DeviceSelector);
        const confirm = C.normalizeConfirmAnnotation(action.invocation.schema as Ast.FunctionDef);

        // if confirm === auto, we leave the compound command as is, but add the [1] clause
        // to the query if necessary
        // otherwise, we split the compound command
        if (confirm === 'auto') {
            let newTable;
            if (tableUsesIDFilter(stmt.table) && !stmt.table.isIndex && !stmt.table.isSlice)
                newTable = new Ast.Table.Index(null, stmt.table, [new Ast.Value.Number(1)], stmt.table.schema);
            else
                newTable = stmt.table;
            const compoundStmt = new Ast.Statement.Command(null, newTable, stmt.actions);
            newStatements.push(compoundStmt);
        } else {
            const queryStmt = new Ast.Statement.Command(null, stmt.table, [C.notifyAction()]);
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
            const actionStmt = new Ast.Statement.Command(null, null, [newAction]);
            newStatements.push(actionStmt);
        }
    } else if (!stmt.table) {
        // action only
        // add a query, if the action refers to an ID entity

        assert(stmt.actions.length === 1);
        const action = stmt.actions[0];
        assert(action instanceof Ast.InvocationAction);
        assert(action.invocation.selector instanceof Ast.DeviceSelector);

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
            if (!(type instanceof Type.Entity) || !_loader.idQueries.has(type.type))
                continue;
            hasIDArg = true;
            if (param.value.isEntity)
                return null;
        }
        if (!hasIDArg) {
            newStatements.push(stmt);
            return newStatements;
        }

        const confirm = C.normalizeConfirmAnnotation(action.invocation.schema as Ast.FunctionDef);
        const clone = action.clone();

        let newTable : Ast.Table|null = null;
        for (const param of clone.invocation.in_params) {
            const type = clone.invocation.schema!.getArgType(param.name);
            if (!(type instanceof Type.Entity) || !_loader.idQueries.has(type.type))
                continue;
            assert(param.value.isUndefined);

            // this assertion will fire if there are two entity parameters of
            // ID type in the same action
            assert(newTable === null);

            const query = _loader.idQueries.get(type.type)!;
            newTable = new Ast.Table.Invocation(null,
                    new Ast.Invocation(null,
                        new Ast.Selector.Device(null, query.class!.name, null, null),
                        query.name,
                        [],
                        query),
                    query);

            if (confirm === 'auto')
                param.value = new Ast.Value.VarRef('id');
        }

        if (confirm === 'auto') {
            newStatements.push(new Ast.Statement.Command(null, newTable, [clone]));
        } else {
            newStatements.push(new Ast.Statement.Command(null, newTable, [C.notifyAction()]));
            newStatements.push(new Ast.Statement.Command(null, null, [clone]));
        }
    } else {
        newStatements.push(stmt);
    }

    return newStatements.map(C.adjustDefaultParameters);
}

function initialRequest(stmt : Ast.ExecutableStatement) {
    const newStatements = adjustStatementsForInitialRequest(stmt);
    if (newStatements === null)
        return null;

    const history = newStatements.map((stmt) => new Ast.DialogueHistoryItem(null, stmt, null, 'accepted'));
    return new Ast.DialogueState(null, 'org.thingpedia.dialogue.transaction', 'execute', null, history);
}

function getStatementDevice(stmt : Ast.Command) {
    if (stmt.table)
        return stmt.table.schema!.class!.name;
    else
        return stmt.actions[0].schema!.class!.name;
}

function startNewRequest(ctx : ContextInfo, stmt : Ast.ExecutableStatement) {
    if (!(stmt instanceof Ast.Command))
        return null;

    if (_loader.flags.strict_multidomain && getStatementDevice(ctx.current!.stmt as Ast.Command) === getStatementDevice(stmt))
        return null;

    const newStatements = adjustStatementsForInitialRequest(stmt);
    if (newStatements === null)
        return null;

    const newItems = newStatements.map((stmt) => new Ast.DialogueHistoryItem(null, stmt, null, 'accepted'));
    return addNewItem(ctx, 'execute', null, 'accepted', ...newItems);
}

function addInitialDontCare(stmt : Ast.ExecutableStatement, dontcare : Ast.DontCareBooleanExpression) {
    if (!(stmt instanceof Ast.Command) || !stmt.table)
        return null;

    const arg = stmt.table.schema!.getArgument(dontcare.name);
    if (!arg || arg.is_input)
        return null;
    if (arg.getAnnotation<boolean>('filterable') === false)
        return null;
    if (!stmt.table.schema!.is_list)
        return null;

    const clone = stmt.clone();
    const [cloneTable, filterTable] = findOrMakeFilterTable(clone.table!);
    assert(filterTable);
    if (!filterTable.table.isInvocation)
        return null;
    clone.table = cloneTable;

    if (C.filterUsesParam(filterTable.filter, dontcare.name))
        return null;

    filterTable.filter = new Ast.BooleanExpression.And(null, [filterTable.filter, dontcare]).optimize();
    return clone;
}

export {
    initialRequest,
    startNewRequest,
    addInitialDontCare
};
