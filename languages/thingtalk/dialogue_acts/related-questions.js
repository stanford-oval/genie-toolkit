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


import assert from 'assert';

import * as C from '../ast_manip';

import {
    addQuery,
} from '../state_manip';
import {
    findOrMakeFilterTable,
    refineFilterToAnswerQuestion,
} from './refinement-helpers';

function relatedQuestion(ctx, stmt) {
    const currentTable = ctx.current.stmt.table;

    if (!stmt.isCommand || !stmt.table)
        return null;
    if (stmt.actions.some((a) => !a.isNotify))
        return null;
    let newTable = stmt.table;
    if (!newTable.schema.class)
        return null;

    if (C.isSameFunction(currentTable.schema, newTable.schema))
        return null;
    let functionName = newTable.schema.class.kind + ':' + newTable.schema.name;
    const related = currentTable.schema.getAnnotation('related');
    if (!related.includes(functionName))
        return null;

    if (!C.checkValidQuery(stmt.table))
        return null;

    let ctxFilterTable, newFilterTable;
    [newTable, newFilterTable] = findOrMakeFilterTable(newTable.clone());
    if (newFilterTable === null)
        return null;
    assert(newFilterTable.isFilter);
    if (!newFilterTable.table.isInvocation)
        return null;

    ctxFilterTable = C.findFilterTable(currentTable);

    if (ctxFilterTable) {
        const newFilter = refineFilterToAnswerQuestion(ctxFilterTable.filter, newFilterTable.filter);
        if (newFilter === null)
            return null;
        newFilterTable.filter = newFilter;
    }

    return addQuery(ctx, 'execute', newTable, 'accepted');
}

export {
    relatedQuestion,
};
