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

const { ValueCategory } = require('../semantic');

const POLICY_NAME = 'org.thingpedia.dialogue.transaction';

function getFunctions(ast) {
    const functions = [];
    ast.visit(new class extends Ast.NodeVisitor {
        visitInvocation(invocation) {
            functions.push(invocation.schema);
            return true;
        }
    });
    return functions;
}

class NextStatementInfo {
    constructor(currentItem, nextItem) {
        this.isAction = !nextItem.stmt.table;

        this.chainParameter = null;
        this.chainParameterFilled = false;

        if (!this.isAction)
            return;

        assert(nextItem.stmt.actions.length === 1);
        const action = nextItem.stmt.actions[0];
        assert(action.isInvocation);

        if (!currentItem)
            return;
        const tableschema = currentItem.stmt.table.schema;
        const idType = tableschema.getArgType('id');
        if (!idType)
            return;

        const invocation = action.invocation;
        const actionschema = invocation.schema;
        for (let arg of actionschema.iterateArguments()) {
            if (!arg.is_input)
                continue;
            if (arg.type.equals(idType)) {
                this.chainParameter = arg.name;
                break;
            }
        }

        if (this.chainParameter === null)
            return;

        for (let in_param of invocation.in_params) {
            if (in_param.name === this.chainParameter && !in_param.value.isUndefined) {
                this.chainParameterFilled = true;
                break;
            }
        }
    }
}

function makeSimpleDialogueAct(dialogueAct, param = null) {
    return new Ast.DialogueState(null, POLICY_NAME, dialogueAct, param, []);
}

function makeSlotFillingDialogueAct(stmt) {
    for (let slot of stmt.iterateSlots2()) {
        if (slot instanceof Ast.Selector)
            continue;
        const value = slot.get();
        if (value.isUndefined)
            return makeSimpleDialogueAct('sys_slot_fill', slot.tag);
    }

    // code should not be reached
    throw new Error('???');
}

/**
 * Find the filter table in the context.
 *
 * If we don't have one, make it up right before the invocation.
 *
 * Returns [root, filterTable]
 */
function findFilterTable(root) {
    let table = root;
    while (!table.isFilter) {
        if (table.isSequence ||
            table.isHistory ||
            table.isWindow ||
            table.isTimeSeries)
            throw new Error('NOT IMPLEMENTED');

        // do not touch these with filters
        if (table.isAggregation ||
            table.isVarRef ||
            table.isResultRef)
            return null;

        // go inside these
        if (table.isSort ||
            table.isIndex ||
            table.isSlice ||
            table.isProjection ||
            table.isCompute ||
            table.isAlias) {
            table = table.table;
            continue;
        }

        if (table.isJoin) {
            // go right on join, always
            table = table.rhs;
            continue;
        }

        assert(table.isInvocation);
        // if we get here, there is no filter table at all
        return null;
    }
    return table;
}

function findAllFilterParameters(filter) {
    const names = [];
    filter.visit(new class extends Ast.NodeVisitor {
        visitAtomBooleanExpression(atom) {
            names.push(atom.name);
            return true;
        }
    });
    return names;
}

function findLastFilter(filter) {
    let clauses;
    if (filter.isAnd)
        clauses = filter.operands;
    else
        clauses = [filter];

    let lastClause = clauses[clauses.length-1];

    const names = findAllFilterParameters(lastClause);
    if (names.length > 0)
        return names[0];
    else
        return null;
}

function getActionInvocation(historyItem) {
    return historyItem.stmt.actions[0].invocation;
}

function addActionParameter(nextInvocation, dialogueAct, pname, value, confirm = false) {
    nextInvocation = nextInvocation.clone();
    for (let in_param of nextInvocation.in_params) {
        if (in_param.name === pname) {
            in_param.value = value;
            break;
        }
    }
    nextInvocation.in_params.push(new Ast.InputParam(null, pname, value));
    nextInvocation.in_params((p1, p2) => {
        if (p1.name < p2.name)
            return -1;
        if (p1.name > p2.name)
            return 1;
        return 0;
    });

    let newStmt = new Ast.Statement.Command(null, null, [new Ast.Action.Invocation(null, nextInvocation, nextInvocation.schema)]);
    let newHistoryItem = new Ast.DialogueHistoryItem(null, newStmt, null, confirm);
    return new Ast.DialogueState(null, POLICY_NAME, dialogueAct, null, [newHistoryItem]);
}

module.exports = {
    async chooseAction(dlg, state) {
        assert(state instanceof Ast.DialogueState);
        assert(state.policy === POLICY_NAME);

        let nextItem = null, nextInfo = null, questionItem = null, currentItem = null;
        for (let idx = 0; idx < state.history.length; idx ++) {
            const item = state.history[idx];
            if (item.results === null) {
                nextItem = item;
                nextInfo = new NextStatementInfo(currentItem, item);
                break;
            }
            const functions = getFunctions(item.stmt);
            if (functions.length > 0)
                currentItem = item;
            else
                questionItem = item;
        }
        if (nextItem !== null)
            assert(nextInfo);

        switch (state.dialogueAct) {
        case 'greet':
            return makeSimpleDialogueAct('sys_greet');

        case 'execute': {
            if (nextInfo !== null) {
                // we have an action we want to execute, or a query that needs confirmation
                if (nextInfo.chainParameter === null || nextInfo.chainParameterFilled) {
                    // we don't need to fill any parameter from the current query

                    if (nextInfo.isComplete)
                        return makeSimpleDialogueAct('sys_confirm_action');
                    else
                        return makeSlotFillingDialogueAct(nextItem.stmt);
                }
            }

            // we must have a result
            assert(currentItem && currentItem.results);
            const filterTable = findFilterTable(currentItem.stmt.table);
            const results = questionItem ? questionItem.results.results : currentItem.results.results;

            if (results.length === 0) {
                // note: aggregation cannot be empty (it would be zero)

                // find the last filter name (which we probably just added) and ask about that one
                if (filterTable) {
                    const pname = findLastFilter(filterTable.filter);
                    if (pname)
                        return makeSimpleDialogueAct('sys_empty_search_question', pname);
                    else
                        return makeSimpleDialogueAct('sys_empty_search');
                } else {
                    return makeSimpleDialogueAct('sys_empty_search');
                }
            }


            if (results.length === 1) {
                // we must recommend
                if (nextItem && !questionItem) {
                    const nextInvocation = getActionInvocation(nextItem);
                    return addActionParameter(nextInvocation, 'sys_recommend_one', nextInfo.chainParameter, results[0].value.id);
                } else {
                    return makeSimpleDialogueAct('sys_recommend_one');
                }
            }

            if (results.length > 20) {
                // we want to refine first
                // naive refinement: choose an unfilled output parameter

                const usedFilters = new Set(filterTable ? findAllFilterParameters(filterTable.filter) : []);
                for (let arg of currentItem.stmt.table.schema.iterateArguments()) {
                    if (arg.is_input)
                        continue;
                    if (usedFilters.has(arg.name))
                        continue;
                    return makeSimpleDialogueAct('sys_search_question', arg.name);
                }
            }

            // fallback to recommending two results from the list
            return makeSimpleDialogueAct('sys_recommend_two');
        }

        case 'learn_more':
            return makeSimpleDialogueAct('sys_learn_more_what');

        default:
            throw new Error(`Unexpected user dialogue act ${state.dialogueAct}`);
        }
    },

    getInteractionState(dlg) {
        // TODO
        return {
            isTerminal: false,
            expect: ValueCategory.Command
        };
    }
};
