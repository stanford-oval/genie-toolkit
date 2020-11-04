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

import {
    ContextInfo,
    addQuery
} from '../state_manip';
import {
    isFilterCompatibleWithInfo,
    isSimpleFilterTable
} from './common';
import { SlotBag } from '../slot_bag';

type UnaryTable = Ast.SortedTable
    | Ast.IndexTable
    | Ast.SlicedTable
    | Ast.ProjectionTable
    | Ast.ComputeTable
    | Ast.AliasTable;

/**
 * Find the filter table in the context.
 *
 * Like findFilterTable, but if we don't have one, make it up right before the invocation.
 *
 * Returns [root, filterTable]
 */
function findOrMakeFilterTable(root : Ast.Table) : [Ast.Table|null, Ast.FilteredTable|null] {
    let table = root;
    let holder : Ast.JoinTable|UnaryTable|null = null;
    while (!(table instanceof Ast.FilteredTable)) {
        // do not touch these with filters
        if (table.isAggregation ||
            table.isVarRef)
            return [null, null];

        // go inside these
        if (table instanceof Ast.SortedTable ||
            table instanceof Ast.IndexTable ||
            table instanceof Ast.SlicedTable ||
            table instanceof Ast.ProjectionTable ||
            table instanceof Ast.ComputeTable ||
            table instanceof Ast.AliasTable) {
            holder = table;
            table = table.table;
            continue;
        }

        if (table instanceof Ast.JoinTable) {
            holder = table;
            // go right on join, always
            table = table.rhs;
            continue;
        }

        assert(table instanceof Ast.InvocationTable);
        // if we get here, there is no filter table at all
        // make up one
        const newFilterTable = new Ast.Table.Filter(null, table, Ast.BooleanExpression.True, table.schema);
        if (holder === null) {
            assert(table === root);
            return [newFilterTable, newFilterTable];
        } else if (holder instanceof Ast.JoinTable) {
            holder.rhs = newFilterTable;
            return [root, newFilterTable];
        } else {
            holder.table = newFilterTable;
            return [root, newFilterTable];
        }
    }

    return [root, table];
}


function setsIntersect<T>(s1 : Set<T>, s2 : Set<T>) : boolean {
    for (const el of s1) {
        if (s2.has(el))
            return true;
    }
    return false;
}


function neutralizeIDFilter(ast : Ast.BooleanExpression) : Ast.BooleanExpression {
    // clone a filter and replace "id == ..." atoms with "true"

    if (ast instanceof Ast.NotBooleanExpression)
        return new Ast.BooleanExpression.Not(null, neutralizeIDFilter(ast.expr));
    if (ast instanceof Ast.OrBooleanExpression)
        return new Ast.BooleanExpression.Or(null, ast.operands.map(neutralizeIDFilter));
    if (ast instanceof Ast.AndBooleanExpression)
        return new Ast.BooleanExpression.And(null, ast.operands.map(neutralizeIDFilter));
    if (ast.isTrue || ast.isDontCare || ast.isFalse || ast.isCompute || ast.isExternal)
        return ast;

    assert(ast instanceof Ast.AtomBooleanExpression);
    if (ast.name === 'id' && ast.operator === '==')
        return Ast.BooleanExpression.True;
    return ast;
}

type SlotBooleanExpression = Ast.AtomBooleanExpression | Ast.DontCareBooleanExpression;

function filterToNegatedSlots(filter : Ast.BooleanExpression) : Record<string, Ast.NotBooleanExpression> {
    filter = filter.optimize();
    const slots : Record<string, Ast.NotBooleanExpression> = {};
    let operands : Ast.BooleanExpression[];
    if (filter instanceof Ast.AndBooleanExpression)
        operands = filter.operands;
    else
        operands = [filter];

    for (const operand of operands) {
        if (!(operand instanceof Ast.NotBooleanExpression))
            continue;
        const atom = operand.expr;
        if (!(atom instanceof Ast.AtomBooleanExpression) &&
            !(atom instanceof Ast.DontCareBooleanExpression))
            continue;

        slots[atom.name] = operand;
    }

    return slots;
}

function filterToSlots(filter : Ast.BooleanExpression) : Record<string, SlotBooleanExpression> {
    filter = filter.optimize();
    const slots : Record<string, SlotBooleanExpression> = {};
    let operands : Ast.BooleanExpression[];
    if (filter instanceof Ast.AndBooleanExpression)
        operands = filter.operands;
    else
        operands = [filter];

    for (const operand of operands) {
        if (!(operand instanceof Ast.AtomBooleanExpression) &&
            !(operand instanceof Ast.DontCareBooleanExpression))
            continue;

        slots[operand.name] = operand;
    }

    return slots;
}

type RefineFilterCallback = (old : Ast.BooleanExpression, new_ : Ast.BooleanExpression) => Ast.BooleanExpression|null;

function queryRefinement(ctxTable : Ast.Table,
                         newFilter : Ast.BooleanExpression|null,
                         refineFilter : RefineFilterCallback|null,
                         newProjection : string[]|null) : Ast.Table|null {
    let cloneTable = ctxTable.clone();

    let refinedFilter : Ast.BooleanExpression;
    if (newFilter !== null) {
        assert(refineFilter);
        const [newCloneTable, filterTable] = findOrMakeFilterTable(cloneTable);
        //if (ctxFilterTable === null)
        //    return null;
        assert(newCloneTable && filterTable);
        cloneTable = newCloneTable;

        // TODO we need to push down the filter, if possible
        if (!isSimpleFilterTable(filterTable))
            return null;

        const newRefinedFilter = refineFilter(filterTable.filter, newFilter);
        if (newRefinedFilter === null)
            return null;
        refinedFilter = newRefinedFilter;
        filterTable.filter = refinedFilter;
    }

    if (newProjection) {
        // if we have a new projection, we remove the projection entirely and replace it
        // with the new one

        if (cloneTable instanceof Ast.ProjectionTable)
            cloneTable = cloneTable.table;
        // there should be no projection of projection (will be optimized)
        assert(!(cloneTable instanceof Ast.ProjectionTable));

        // remove a compute table as well (top-level compute is a sort of projection)
        if (cloneTable instanceof Ast.ComputeTable)
            cloneTable = cloneTable.table;

        // still no projection here...
        assert(!(cloneTable instanceof Ast.ProjectionTable));

        cloneTable = new Ast.Table.Projection(null, cloneTable, newProjection,
            C.resolveProjection(newProjection, cloneTable.schema!));
    } else {
        // otherwise, we remove all fields from the projection that were mentioned in the
        // filter

        let oldProjection : string[]|undefined;
        if (cloneTable instanceof Ast.ProjectionTable) {
            oldProjection = cloneTable.args;
            cloneTable = cloneTable.table;
        }
        // there should be no projection of projection (will be optimized)
        assert(!(cloneTable instanceof Ast.ProjectionTable));

        // either one of newProjection or newFilter must be provided
        assert(newFilter !== null);

        if (oldProjection) {
            const newProjection = oldProjection.filter((pname) => !C.filterUsesParam(refinedFilter, pname));

            // if we removed the projection of the compute field, remove the projection entirely
            if (cloneTable instanceof Ast.ComputeTable) {
                assert(cloneTable.expression instanceof Ast.Value.Computation);
                const field = cloneTable.expression.op;
                if (!newProjection.includes(field))
                    cloneTable = cloneTable.table;

                // there should still be no projection of projection (will be optimized)
                assert(!(cloneTable instanceof Ast.ProjectionTable));
            }

            // if the projection is now empty, we don't add
            // the projection will be empty if
            // 1. the user asks a question
            // 2. the agent answers that question
            // 3. the user now refines the search indicating they don't like that answer
            //
            // on the other hand, if
            // 1. the user asks a question (eg. asks for "address")
            // 2. the agent answers that question
            // 3. the user now refines the search changing a different parameter
            // we will keep the projection

            if (newProjection.length > 0) {
                cloneTable = new Ast.Table.Projection(null, cloneTable, newProjection,
                    C.resolveProjection(newProjection, cloneTable.schema!));
            }
        }
    }

    return cloneTable;
}


function refineFilterToAnswerQuestion(ctxFilter : Ast.BooleanExpression,
                                      refinedFilter : Ast.BooleanExpression) {
    // this function is used when:
    // - the agent asks a search refinement question, and the user answers it
    // - the agent proposes something to refine the question
    //
    // the refinement is allowed only if the parameter was not mentioned before
    // furthermore, "id ==" filters are removed from the refined filter, so a user
    // can choose a restaurant for a while then change their mind

    function getParamsInFilter(filter : Ast.BooleanExpression) {
        const params = new Set<string>();
        filter.visit(new class extends Ast.NodeVisitor {
            visitAtomBooleanExpression(atom : Ast.AtomBooleanExpression) {
                if (atom.name === 'id' && atom.operator === '==')
                    return false;
                params.add(atom.name);
                return false;
            }
            visitDontCareBooleanExpression(atom : Ast.DontCareBooleanExpression) {
                params.add(atom.name);
                return false;
            }
            visitExternalBooleanExpression() {
                return false;
            }
        });
        return params;
    }
    if (setsIntersect(getParamsInFilter(ctxFilter),  getParamsInFilter(refinedFilter)))
        return null;

    const clone = neutralizeIDFilter(ctxFilter);
    return new Ast.BooleanExpression.And(null, [clone, refinedFilter]).optimize();
}


function refineFilterToAnswerQuestionOrChangeFilter(ctxFilter : Ast.BooleanExpression,
                                                    refinedFilter : Ast.BooleanExpression) {
    // this function is used:
    // - the agent proposes something, and the user replies with a bunch of filters
    //   (e.g. "how about terun?" "nah i'm looking for something chinese")
    //
    // the refinement is allowed only if the parameter was not mentioned before
    // at most one parameter can be mentioned in the context, in which case it must be different
    //
    // the refinement contains all clauses which are not explicitly negated in the refinement,
    // plus all of the refinement
    // furthermore, "id ==" filters are removed from the refined filter, so a user
    // can choose a restaurant for a while then change their mind

    ctxFilter = ctxFilter.optimize();
    refinedFilter = refinedFilter.optimize();

    const ctxSlots = filterToSlots(ctxFilter);
    const refinedSlots = filterToSlots(refinedFilter);
    const negatedRefinedSlots = filterToNegatedSlots(refinedFilter);

    let changedParam : string|undefined = undefined;
    // slots in the context must not mentioned in the refinement, except at most one can, and
    // it must be different operator or value
    //
    // note that both positive and negative filters are killed by this check
    // so neither "I want X food" nor "I don't like X food" are acceptable when "food =~ X" was
    // already in the context
    for (const key in ctxSlots) {
        assert(ctxSlots[key] instanceof Ast.AtomBooleanExpression ||
               ctxSlots[key] instanceof Ast.DontCareBooleanExpression);
        if (negatedRefinedSlots[key])
            return null;
        if (refinedSlots[key]) {
            // dont change opinion from a dontcare to a not dontcare
            if (ctxSlots[key] instanceof Ast.DontCareBooleanExpression)
                return null;

            if (refinedSlots[key].equals(ctxSlots[key]))
                return null;
            if (changedParam !== undefined)
                return null;
            changedParam = key;
        }
    }

    const newCtxClauses : Ast.BooleanExpression[] = [];
    for (const clause of (ctxFilter instanceof Ast.AndBooleanExpression ? ctxFilter.operands : [ctxFilter])) {
        if (clause instanceof Ast.AtomBooleanExpression || clause instanceof Ast.DontCareBooleanExpression) {
            if (refinedSlots[clause.name])
                continue;
        }
        newCtxClauses.push(neutralizeIDFilter(clause));
    }

    return new Ast.BooleanExpression.And(null, [...newCtxClauses, refinedFilter]).optimize();
}


function refineFilterToChangeFilter(ctxFilter : Ast.BooleanExpression,
                                    refinedFilter : Ast.BooleanExpression) {
    // this function is used:
    // - when the agent returned zero results, and the user
    //   must change the search
    // - when the agent makes a filter proposal, and the user says no I want something else
    //
    // the refinement is allowed only if no new parameters are introduced (all parameters were
    // mentioned before), and at least one parameter is different than before
    //
    // the resulting filter uses all the parameters in ctxFilter that are not mentioned
    // in refinedFilter, as well as all of refinedFilter

    ctxFilter = ctxFilter.optimize();
    refinedFilter = refinedFilter.optimize();

    const ctxSlots = filterToSlots(ctxFilter);
    const refinedSlots = filterToSlots(refinedFilter);
    // all slots in the context must be either not mentioned in the refinement, or changed
    for (const key in ctxSlots) {
        if (refinedSlots[key] && refinedSlots[key].equals(ctxSlots[key]))
            return null;
    }
    // all slots that are in the refinement must be mentioned in the context
    for (const key in refinedSlots) {
        if (!ctxSlots[key])
            return null;
    }

    const ctxClauses = (ctxFilter instanceof Ast.AndBooleanExpression ? ctxFilter.operands : [ctxFilter]).filter((clause) => {
        let good = true;
        clause.visit(new class extends Ast.NodeVisitor {
             visitExternalBooleanExpression() {
                // do not recurse
                // get rid of get-predicates in the context, regardless
                good = false;
                return false;
            }
            visitValue() {
                // do not recurse
                return false;
            }

            visitAtomBooleanExpression(atom : Ast.AtomBooleanExpression) {
                good = good && !C.filterUsesParam(refinedFilter, atom.name);
                return true;
            }
            visitDontCareBooleanExpression(atom : Ast.DontCareBooleanExpression) {
                good = good && !C.filterUsesParam(refinedFilter, atom.name);
                return true;
            }
        });
        return good;
    });

    return new Ast.BooleanExpression.And(null, [...ctxClauses, refinedFilter]).optimize();
}

/**
 * User act: in response to any proposal from the agent (refined query, recommendation, list
 * proposal), the user replies with a search.
 */
function proposalReply(ctx : ContextInfo,
                       request : Ast.Table,
                       refinementFunction : RefineFilterCallback) {
    if (!C.isSameFunction(ctx.currentFunctionSchema!, request.schema!))
        return null;

    // TODO we need to push down the filter, if possible
    if (!isSimpleFilterTable(request))
        return null;

    const currentStmt = ctx.current!.stmt;
    assert(currentStmt instanceof Ast.Command);
    const currentTable = currentStmt.table!;
    const newTable = queryRefinement(currentTable, request.filter, refinementFunction, null);
    if (newTable === null)
        return null;

    return addQuery(ctx, 'execute', newTable, 'accepted');
}

function isValidNegativePreambleForInfo(info : SlotBag, preamble : Ast.FilteredTable) : boolean {
    // the preamble must match the info provided
    // (and we will negate it later)
    return isFilterCompatibleWithInfo(info, preamble.filter);
}

function combinePreambleAndRequest(preamble : Ast.FilteredTable|null,
                                   request : Ast.FilteredTable|null,
                                   info : SlotBag|null,
                                   proposalType : Type) {
    if (preamble !== null) {
        if (info === null || !isValidNegativePreambleForInfo(info, preamble))
            return null;
    }

    if (preamble !== null && request !== null) {
        if (!C.isSameFunction(preamble.schema!, request.schema!))
            return null;
        const refined = refineFilterToChangeFilter(preamble.filter, request.filter);
        if (refined === null)
            return null;

        // convert the preamble into a request by negating it, then add the new request
        request = new Ast.FilteredTable(null, request.table, new Ast.BooleanExpression.And(null, [
            new Ast.BooleanExpression.Not(null, preamble.filter),
            request.filter
        ]), request.schema);
    } else if (preamble !== null) {
        // convert the preamble into a request by negating it
        // shallow clone
        assert(preamble instanceof Ast.FilteredTable);
        request = new Ast.Table.Filter(null, preamble.table, preamble.filter, preamble.schema);
        request.filter = new Ast.BooleanExpression.Not(null, request.filter);
    }
    assert(request !== null);

    const idType = request.schema!.getArgType('id');

    if (!idType || !idType.equals(proposalType))
        return null;

    return request;
}

export {
    findOrMakeFilterTable,
    queryRefinement,
    refineFilterToAnswerQuestion,
    refineFilterToAnswerQuestionOrChangeFilter,
    refineFilterToChangeFilter,
    proposalReply,
    combinePreambleAndRequest
};
