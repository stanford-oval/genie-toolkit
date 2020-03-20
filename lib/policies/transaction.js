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
const Describe = ThingTalk.Describe;

const { ValueCategory } = require('../semantic');
const Helpers = require('../helpers');

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

function computeStateInfo(state) {
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

    return [nextItem, nextInfo, questionItem, currentItem];
}

function findControllingSchema(dialogueAct, nextItem, currentItem) {
    if (dialogueAct === 'sys_slot_fill') {
        return getActionInvocation(nextItem).schema;
    } else {
        let table = currentItem.stmt.table;
        if (table.isProjection)
            table = table.table;
        return table.schema;
    }
}

async function replyFormattedResult(dlg, result) {
    const [outputType, outputValue] = result;
    let messages;
    if (outputType !== null)
        messages = await dlg.formatter.formatForType(outputType, outputValue, 'messages');
    else
        messages = outputValue;
    if (!Array.isArray(messages))
        messages = [messages];

    for (let message of messages) {
        if (typeof message === 'string')
            message = { type: 'text', text: message };

        if (typeof message !== 'object')
            continue;

        if (message.type === 'text') {
            await dlg.reply(message.text);
        } else if (message.type === 'picture') {
            if (message.url === undefined)
                await dlg.reply("Sorry, I can't find the picture you want.");
            else
                await dlg.replyPicture(message.url);
        } else if (message.type === 'rdl') {
            await dlg.replyRDL(message);
        } else if (message.type === 'button') {
            await dlg.replyButton(message.text, message.json);
        } else if (message.type === 'program') {
            const loaded = Helpers.loadOneExample(dlg, message.program);
            await dlg.replyButton(Helpers.presentExample(dlg, loaded.utterance), loaded.target);
        } else {
            await dlg.replyResult(message);
        }
    }
}

module.exports = {
    async chooseAction(dlg, state) {
        assert(state instanceof Ast.DialogueState);
        assert(state.policy === POLICY_NAME);
        const [nextItem, nextInfo, questionItem, currentItem] = computeStateInfo(state);

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

    async reply(dlg, state) {
        const [nextItem, nextInfo, questionItem, currentItem] = computeStateInfo(state);
        const describer = new Describe.Describer(dlg.manager.gettext, dlg.manager.locale, dlg.manager.timezone);

        switch (state.dialogueAct) {
        case 'sys_greet':
            await dlg.reply(dlg._("Hello! How can I help you?"));
            return;

        case 'sys_confirm_action':
            assert(nextInfo);
            await dlg.replyInterp(dlg._("Ok, so you want me to ${confirmation}. Is that right?"), { //"
                confirmation: describer.describeProgram(new Ast.Program(null, [], [], [nextItem.stmt]))
            });
            return;

        case 'sys_slot_fill':
        case 'sys_search_question': {
            const schema = findControllingSchema(state.dialogueAct, nextItem, currentItem);
            const questions = state.dialogueActParam.map((pname) => {
                const arg = schema.getArgument(pname);
                if (arg && arg.metadata.prompt) {
                    return arg.metadata.prompt;
                } else {
                    return dlg.interpolate(dlg._("What ${argcanonical} are you looking for?"), {
                        argcanonical: arg.canonical
                    });
                }
            });
            await dlg.replyInterp("${questions}", { questions });
            return;
        }

        case 'sys_empty_search_question':
            if (state.dialogueActParam) {
                const schema = (questionItem || currentItem).stmt.table.schema;
                const arg = schema.getArgument(state.dialogueActParam[0]);
                await dlg.replyInterp(dlg._("There are no ${table}. How about a different ${argcanonical}?"), {
                    argcanonical: arg ? arg.canonical : state.dialogueActParam[0],
                    table: describer.describeTable((questionItem || currentItem).stmt.table, [])
                });
                return;
            }

        case 'sys_empty_search':
            await dlg.replyInterp(dlg._("There are no ${table}."), {
                table: describer.describeTable((questionItem || currentItem).stmt.table, [])
            });
            return;

        case 'sys_recommend_one':
            if (questionItem) {
                // answer the question directly
                for (let result of questionItem.results.results)
                    await replyFormattedResult(dlg, result.raw);
            } else {
                const topResult = currentItem.results.results[0];
                if (topResult.value.id)
                    await dlg.replyInterp(dlg._("I have found ${name}."), { name: topResult.value.id.display });
                await replyFormattedResult(dlg, topResult.raw);
            }
            break;

        case 'sys_recommend_two':
            if (!questionItem)
                await dlg.reply(dlg._("Here is what I found."));
            {
                const results = (questionItem || currentItem).results.results;
                for (let i = 0; i < Math.min(results.length, 3); i++)
                    await replyFormattedResult(dlg, results[i].raw);
            }
            break;

        case 'sys_learn_more_what':
            await dlg.reply("What would you like to know?");
            break;

        default:
            throw new Error(`Unexpected system dialogue act ${state.dialogueAct}`);
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
