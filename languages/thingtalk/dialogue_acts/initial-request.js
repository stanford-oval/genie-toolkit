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

const C = require('../ast_manip');
const _loader = require('../load-thingpedia');

const {
    addNewItem,
} = require('../state_manip');
const {
    findOrMakeFilterTable
} = require('./refinement-helpers');

function adjustStatementsForInitialRequest(stmt) {
    if (stmt.stream && _loader.flags.nostream)
        return null;

    if (stmt.table && !C.checkValidQuery(stmt.table))
        return null;

    const newStatements = [];
    if (stmt.table && stmt.actions.some((a) => !a.isNotify)) {
        // split into two statements, one getting the data, and the other using it

        const queryStmt = new Ast.Statement.Command(null, stmt.table, [C.notifyAction()]);
        newStatements.push(queryStmt);

        const newActions = stmt.actions.map((a) => a.clone());
        for (let action of newActions) {
            if (!action.isInvocation)
                throw new TypeError('???');
            assert (action.invocation.selector.isDevice);

            const in_params = action.invocation.in_params;
            for (let in_param of in_params) {
                if (in_param.value.isEvent) // TODO
                    return null;
                if (!in_param.value.isVarRef)
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
        }
        const actionStmt = new Ast.Statement.Command(null, null, newActions);
        newStatements.push(actionStmt);
    } else {
        if (!stmt.table) {
            for (let action of stmt.actions) {
                for (let param of action.invocation.in_params) {
                    if (param.value.isUndefined) {
                        const type = action.invocation.schema.getArgType(param.name);
                        if (type.isEntity && _loader.idQueries.has(type.type)) {
                            const query = _loader.idQueries.get(type.type);
                            newStatements.push(new Ast.Statement.Command(null, new Ast.Table.Invocation(null,
                                new Ast.Invocation(null,
                                    new Ast.Selector.Device(null, query.class.name, null, null),
                                    query.name,
                                    [],
                                    query),
                                query), [C.notifyAction()]));
                        }
                    }
                }
            }
        }
        newStatements.push(stmt);
    }

    return newStatements;
}

function initialRequest(stmt) {
    const newStatements = adjustStatementsForInitialRequest(stmt);
    if (newStatements === null)
        return null;

    const history = newStatements.map((stmt) => new Ast.DialogueHistoryItem(null, stmt, null, 'accepted'));
    return new Ast.DialogueState(null, 'org.thingpedia.dialogue.transaction', 'execute', null, history);
}

function getStatementDevice(stmt) {
    if (stmt.table)
        return stmt.table.schema.class.name;
    else
        return stmt.actions[0].schema.class.name;
}

function startNewRequest(ctx, stmt) {
    if (_loader.flags.strict_multidomain && getStatementDevice(ctx.current.stmt) === getStatementDevice(stmt))
        return null;

    const newStatements = adjustStatementsForInitialRequest(stmt);
    if (newStatements === null)
        return null;

    const newItems = newStatements.map((stmt) => new Ast.DialogueHistoryItem(null, stmt, null, 'accepted'));
    return addNewItem(ctx, 'execute', null, 'accepted', ...newItems);
}

function addInitialDontCare(stmt, dontcare) {
    if (!stmt.table)
        return null;

    const arg = stmt.table.schema.getArgument(dontcare.name);
    if (!arg || arg.is_input)
        return null;
    if (arg.getAnnotation('filterable') === false)
        return null;
    if (!stmt.table.schema.is_list)
        return null;

    let clone = stmt.clone();
    let [cloneTable, filterTable] = findOrMakeFilterTable(clone.table);
    assert(filterTable.isFilter);
    if (!filterTable.table.isInvocation)
        return null;
    clone.table = cloneTable;

    if (C.filterUsesParam(filterTable.filter, dontcare.name))
        return null;

    filterTable.filter = new Ast.BooleanExpression.And(null, [filterTable.filter, dontcare]).optimize();
    return clone;
}

module.exports = {
    initialRequest,
    startNewRequest,
    addInitialDontCare
};
