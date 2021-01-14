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
    isSimpleFilterExpression
} from './common';
import { SlotBag } from '../slot_bag';

type UnaryExpression = Ast.SortExpression
    | Ast.MonitorExpression
    | Ast.IndexExpression
    | Ast.SliceExpression
    | Ast.ProjectionExpression
    | Ast.AliasExpression;

/**
 * Find the filter expression in the context.
 *
 * Like findFilterExpression, but if we don't have one, make it up right before the invocation.
 *
 * Returns [root, filterTable]
 */
function findOrMakeFilterExpression(root : Ast.ChainExpression) : Ast.FilterExpression|null {
    let expr : Ast.Expression = root;
    let holder : Ast.ChainExpression|UnaryExpression|null = null;
    while (!(expr instanceof Ast.FilterExpression)) {
        // do not touch these with filters
        if (expr instanceof Ast.AggregationExpression ||
            expr instanceof Ast.FunctionCallExpression)
            return null;

        // go inside these
        if (expr instanceof Ast.SortExpression ||
            expr instanceof Ast.MonitorExpression ||
            expr instanceof Ast.IndexExpression ||
            expr instanceof Ast.SliceExpression ||
            expr instanceof Ast.ProjectionExpression ||
            expr instanceof Ast.AliasExpression) {
            holder = expr;
            expr = expr.expression;
            continue;
        }

        if (expr instanceof Ast.ChainExpression) {
            holder = expr;
            // go right on join, but don't go into the action
            const maybeExpr = expr.lastQuery;
            if (!maybeExpr)
                return null;
            expr = maybeExpr;
            continue;
        }

        assert(expr instanceof Ast.InvocationExpression);
        // if we get here, there is no filter table at all
        // make up one
        const newFilterTable = new Ast.FilterExpression(null, expr, Ast.BooleanExpression.True, expr.schema);
        assert(holder !== null);
        if (holder instanceof Ast.ChainExpression) {
            holder.setLastQuery(newFilterTable);
            return newFilterTable;
        } else {
            holder.expression = newFilterTable;
            return newFilterTable;
        }
    }

    return expr;
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

function queryRefinement(ctxExpression : Ast.ChainExpression,
                         newFilter : Ast.BooleanExpression|null,
                         refineFilter : RefineFilterCallback|null,
                         newProjection : string[]|null) : Ast.Expression|null {
    const cloneExpression = ctxExpression.clone();

    let refinedFilter : Ast.BooleanExpression;
    if (newFilter !== null) {
        assert(refineFilter);
        const filterExpression = findOrMakeFilterExpression(cloneExpression);
        //if (ctxFilterTable === null)
        //    return null;
        assert(filterExpression);

        // TODO we need to push down the filter, if possible
        if (!isSimpleFilterExpression(filterExpression))
            return null;

        const newRefinedFilter = refineFilter(filterExpression.filter, newFilter);
        if (newRefinedFilter === null)
            return null;
        refinedFilter = newRefinedFilter;
        filterExpression.filter = refinedFilter;
    }

    // a projection always applies to the last element in the chain
    // (which must be a query, not an action)
    let last = cloneExpression.last;
    if (newProjection) {
        // if we have a new projection, we first remove the existing one
        if (last instanceof Ast.ProjectionExpression)
            last = last.expression;
        // there should be no projection of projection (will be optimized)
        assert(!(last instanceof Ast.ProjectionExpression));

        cloneExpression.last = new Ast.ProjectionExpression(null, last, newProjection, [], [],
            C.resolveProjection(last.schema!, newProjection));
    } else {
        // otherwise, we remove all fields from the projection that were mentioned in the
        // filter

        let oldProjection : string[] = [];
        let oldComputation : Ast.Value[] = [];
        let oldAliases : Array<string|null> = [];
        if (last instanceof Ast.ProjectionExpression) {
            oldProjection = last.args;
            oldComputation = last.computations;
            oldAliases = last.aliases;
            last = last.expression;
        }
        // there should be no projection of projection (will be optimized)
        assert(!(last instanceof Ast.ProjectionExpression));

        // either one of newProjection or newFilter must be provided
        assert(newFilter !== null);

        if (oldProjection) {
            const newProjection = oldProjection.filter((pname) => !C.filterUsesParam(refinedFilter, pname));

            // if the projection is now empty, we don't add it
            //
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
                cloneExpression.last = new Ast.ProjectionExpression(null, last, newProjection,
                    oldComputation, oldAliases, C.resolveProjection(last.schema!, newProjection));
            }
        }
    }

    return cloneExpression;
}

class GetParamsVisitor extends Ast.NodeVisitor {
    params = new Set<string>();

    visitAtomBooleanExpression(atom : Ast.AtomBooleanExpression) {
        if (atom.name === 'id' && atom.operator === '==')
            return false;
        this.params.add(atom.name);
        return false;
    }
    visitDontCareBooleanExpression(atom : Ast.DontCareBooleanExpression) {
        this.params.add(atom.name);
        return false;
    }
    visitExternalBooleanExpression() {
        return false;
    }
}

function getParamsInFilter(filter : Ast.BooleanExpression) {
    const visitor = new GetParamsVisitor();
    filter.visit(visitor);
    return visitor.params;
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

class IsGoodFilterForChangeFilterVisitor extends Ast.NodeVisitor {
    good = true;
    constructor(private refinedFilter : Ast.BooleanExpression) {
        super();
    }

    visitExternalBooleanExpression() {
        // do not recurse
        // get rid of get-predicates in the context, regardless
        this.good = false;
        return false;
    }
    visitValue() {
        // do not recurse
        return false;
    }

    visitAtomBooleanExpression(atom : Ast.AtomBooleanExpression) {
        this.good = this.good && !C.filterUsesParam(this.refinedFilter, atom.name);
        return true;
    }
    visitDontCareBooleanExpression(atom : Ast.DontCareBooleanExpression) {
        this.good = this.good && !C.filterUsesParam(this.refinedFilter, atom.name);
        return true;
    }
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

    const visitor = new IsGoodFilterForChangeFilterVisitor(refinedFilter);
    const ctxClauses = (ctxFilter instanceof Ast.AndBooleanExpression ? ctxFilter.operands : [ctxFilter]).filter((clause) => {
        visitor.good = true;
        clause.visit(visitor);
        return visitor.good;
    });

    return new Ast.BooleanExpression.And(null, [...ctxClauses, refinedFilter]).optimize();
}

/**
 * User act: in response to any proposal from the agent (refined query, recommendation, list
 * proposal), the user replies with a search.
 */
function proposalReply(ctx : ContextInfo,
                       request : Ast.Expression,
                       refinementFunction : RefineFilterCallback) {
    if (!C.isSameFunction(ctx.currentFunction!, request.schema!))
        return null;

    // TODO we need to push down the filter, if possible
    if (!isSimpleFilterExpression(request))
        return null;

    const currentStmt = ctx.current!.stmt;
    const currentExpression = currentStmt.expression!;
    const newTable = queryRefinement(currentExpression, request.filter, refinementFunction, null);
    if (newTable === null)
        return null;

    return addQuery(ctx, 'execute', newTable, 'accepted');
}

function isValidNegativePreambleForInfo(info : SlotBag, preamble : Ast.FilterExpression) : boolean {
    // the preamble must match the info provided
    // (and we will negate it later)
    return isFilterCompatibleWithInfo(info, preamble.filter);
}

function combinePreambleAndRequest(preamble : Ast.FilterExpression|null,
                                   request : Ast.FilterExpression|null,
                                   info : SlotBag|null,
                                   proposalType : Type|null) {
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
        request = new Ast.FilterExpression(null, request.expression, new Ast.BooleanExpression.And(null, [
            new Ast.BooleanExpression.Not(null, preamble.filter),
            request.filter
        ]), request.schema);
    } else if (preamble !== null) {
        // convert the preamble into a request by negating it
        // shallow clone
        assert(preamble instanceof Ast.FilterExpression);
        request = new Ast.FilterExpression(null, preamble.expression, preamble.filter, preamble.schema);
        request.filter = new Ast.BooleanExpression.Not(null, request.filter);
    }
    assert(request !== null);

    if (proposalType) {
        const idType = request.schema!.getArgType('id');
        if (!idType || !idType.equals(proposalType))
            return null;
    }

    return request;
}

export {
    findOrMakeFilterExpression,
    queryRefinement,
    refineFilterToAnswerQuestion,
    refineFilterToAnswerQuestionOrChangeFilter,
    refineFilterToChangeFilter,
    proposalReply,
    combinePreambleAndRequest
};
