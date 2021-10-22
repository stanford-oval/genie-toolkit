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
import { Ast } from 'thingtalk';

import { ContextTable } from '../sentence-generator/types';
import ThingpediaLoader from './load-thingpedia';

import * as C from './ast_manip';
import * as S from './state_manip';
import * as D from './dialogue_acts';

export * as Templates from './dialogue.genie.out';
import { $load } from './dialogue.genie.out';
export {
    $load as initializeTemplates
};

/**
 * This module defines the basic logic of transaction dialogues: how
 * the dialogue is started, how the agent handles each state, and how
 * the agent follows up.
 */

/**
 * Metadata about this dialogue policy
 */
export const MANIFEST = {
    name: 'org.thingpedia.dialogue.transaction',

    dialogueActs: {
        user: [
            // user says hi!
            'greet',
            // user says they want to do something else (same as greet but without the "hi" part)
            'reinit',
            // user issues a ThingTalk program
            'execute',
            // user wants to see the result of the previous program (in reply to a generic search question)
            'ask_recommend',
            // user insists in reiterating the same search after an empty search error
            'insist',
            // user wants to see more output from the previous result
            'learn_more',
            // user asks to see an output parameter from the previous result
            'action_question',
            // user says closes the dialogue mid-way (in the middle of a search)
            'cancel',
            // user terminates the dialogue after the agent asked if there is anything
            // else the user wants
            // "end" is a terminal state, it has no continuations
            // (the agent replies with sys_goodbye which itself generates no user reply)
            'end',
            // pseudo state used to enter the dialogue state machine for notifications
            'notification',
            // pseudo state used to enter the dialogue state machine before the first turn
            'init'
        ],
        agent: [
            // agent says hi back
            'sys_greet',
            // agent asks a question to refine a query (with or without a parameter)
            'sys_search_question',
            'sys_generic_search_question',
            // agent asks a question to slot fill a program
            'sys_slot_fill',
            // agent recommends one, two, three, four, or more results from the program (with or without an action)
            'sys_recommend_one',
            'sys_recommend_two',
            'sys_recommend_three',
            'sys_recommend_four',
            'sys_recommend_many',
            // agent displays the result of a non-list query (incl. aggregation)
            'sys_display_result',
            // agent proposes a refined query
            'sys_propose_refined_query',
            // agent asks the user what they would like to hear
            'sys_learn_more_what',
            // agent informs that the search is empty (with and without a slot-fill question)
            'sys_empty_search_question',
            'sys_empty_search',
            // agent confirms the action before executing it
            'sys_confirm_action',
            // agent executed the action successfully (and shows the result of the action)
            'sys_action_success',
            // agent had an error in executing the action (with and without a slot-fill question)
            'sys_action_error_question',
            'sys_action_error',
            // agent started a rule (command with stream) successfully
            'sys_rule_enable_success',
            // agent asks if anything else is needed
            'sys_anything_else',
            // agent says good bye
            'sys_end',
            // agent asks the user a free-form command
            'sys_record_command',
        ],
        withParam: [
            'action_question',
            'notification',
            'sys_search_question',
            'sys_slot_fill',
            'sys_empty_search_question',
            'sys_action_error_question'
        ],
    },

    terminalAct: 'sys_end'
} as const;

/**
 * Extract all the relevant context phrases for the given state.
 *
 * The context phrases will be used to generate the agent reply,
 * and are mapped to the context non-terminals defined in dialogue.genie.
 *
 * At a high-level, this function maps a concrete dialogue state
 * (produced by the simulation or the neural network)
 * to an abstract dialogue state defined in the state machine, and extracts
 * auxiliary phrases used to construct the reply.
 */
export function getContextPhrasesForState(state : Ast.DialogueState|null,
                                          tpLoader : ThingpediaLoader,
                                          contextTable : ContextTable) {
    if (state === null)
        return [S.makeContextPhrase(contextTable.ctx_init, S.initialContextInfo(tpLoader, contextTable))];

    assert(state instanceof Ast.DialogueState, `expected a dialogue state Ast node`);
    if (state.policy !== S.POLICY_NAME)
        return null;
    const ctx = S.getContextInfo(tpLoader, state, contextTable);
    // get the main context tags for this context (the abstract state, in paper terminology)
    const tags = S.tagContextForAgent(ctx);

    const phrases = tags.map((tag) => S.makeContextPhrase(tag, ctx));
    // add auxiliary context non-terminals used for pruning and to simplify generation
    phrases.push(...S.getAgentContextPhrases(ctx));
    return phrases;
}

/**
 * Handle answers generated from the UI.
 *
 * This function converts the answer to the appropriate dialogue state at this turn,
 * if possible, or returns `null` to signal failure.
 */
export function interpretAnswer(state : Ast.DialogueState,
                                answer : Ast.Value,
                                tpLoader : ThingpediaLoader,
                                contextTable : ContextTable) : Ast.DialogueState|null {
    const ctx = S.getContextInfo(tpLoader, state, contextTable);

    // if the agent proposed something and the user says "yes", we accept the proposal
    if (state.history.length > 0 && state.history[state.history.length-1].confirm === 'proposed'
        && answer instanceof Ast.BooleanValue) {
        if (answer.value) // yes accepts
            return S.acceptAllProposedStatements(ctx);
        else // no is cancel
            return S.makeSimpleState(ctx, 'cancel', null);
    }

    switch (state.dialogueAct) {
    case 'sys_record_command':
        return S.makeSimpleState(ctx, 'end', null);

    case 'sys_anything_else':
        if (answer instanceof Ast.BooleanValue) {
            if (answer.value)
                return S.makeSimpleState(ctx, 'reinit', null);
            else
                return S.makeSimpleState(ctx, 'end', null);
        }
        return null;
    case 'sys_recommend_one':
    case 'sys_recommend_two':
    case 'sys_recommend_three':
    case 'sys_recommend_four':
        // "yes" to a recommendation (without a proposed action) is an answer to
        // "would you like to learn more"
        if (answer instanceof Ast.BooleanValue && answer.value === true)
            return S.makeSimpleState(ctx, 'learn_more', null);
        // fallthrough
    case 'sys_display_result':
        // "no" to a recommendation or display result is cancel
        if (answer instanceof Ast.BooleanValue && answer.value === false)
            return S.makeSimpleState(ctx, 'cancel', null);
        return null;

    case 'sys_slot_fill':
        return D.impreciseSlotFillAnswer(ctx, answer);
    case 'sys_search_question':
        return D.impreciseSearchQuestionAnswer(ctx, answer);
    case 'sys_confirm_action':
        if (answer instanceof Ast.BooleanValue) {
            if (answer.value)
                return D.actionConfirmAcceptPhrase(ctx);
            else
                return D.actionConfirmRejectPhrase(ctx);
        }
        return null;
    default:
        return null;
    }
}

/**
 * Handle notifications.
 *
 * This function prepares a dialogue state suitable for displaying a notification.
 */
export function notification(appName : string|null, program : Ast.Program, result : Ast.DialogueHistoryResultItem) {
    assert(program.statements.length === 1);
    const stmt = program.statements[0];
    assert(stmt instanceof Ast.ExpressionStatement);

    return new Ast.DialogueState(null, S.POLICY_NAME, 'notification', appName ? [new Ast.Value.String(appName)] : null,
        [new Ast.DialogueHistoryItem(null, stmt, new Ast.DialogueHistoryResultList(null, [result], new Ast.NumberValue(1), false), 'confirmed')]);
}

export function notifyError(appName : string|null, program : Ast.Program, error : Ast.Value) {
    assert(program.statements.length === 1);
    const stmt = program.statements[0];
    assert(stmt instanceof Ast.ExpressionStatement);

    return new Ast.DialogueState(null, S.POLICY_NAME, 'notification', appName ? [new Ast.Value.String(appName)] : null,
        [new Ast.DialogueHistoryItem(null, stmt, new Ast.DialogueHistoryResultList(null, [], new Ast.NumberValue(0), false, error), 'confirmed')]);
}

/**
 * Compute the initial state of the dialogue.
 */
export function initialState(tpLoader : ThingpediaLoader) {
    const initialFunction = tpLoader.initialFunction;
    if (!initialFunction)
        return null;

    const selector = new Ast.DeviceSelector(null, initialFunction.class!.name, null, null, []);
    const invocation = new Ast.Invocation(null, selector, initialFunction.name, [], initialFunction);
    // add required arguments to the invocation, or we'll fail to notice this statement is not executable
    for (const arg of initialFunction.iterateArguments()) {
        if (arg.is_input && arg.required)
            invocation.in_params.push(new Ast.InputParam(null, arg.name, new Ast.Value.Undefined(true)));
    }

    const stmt = new Ast.ExpressionStatement(null, new Ast.InvocationExpression(null,
        invocation, initialFunction));
    return new Ast.DialogueState(null, S.POLICY_NAME, 'init', null, [new Ast.DialogueHistoryItem(null, stmt, null, 'accepted')]);
}

/**
 * Compute a possible agent follow up to the given state.
 *
 * @deprecated This function is bad and needs to be refactored out.
 */
export function getFollowUp(state : Ast.DialogueState,
                            tpLoader : ThingpediaLoader,
                            contextTable : ContextTable) {
    const ctx = S.getContextInfo(tpLoader, state, contextTable);
    if (ctx.next)
        return null;

    const current = ctx.current;
    if (!current)
        return null;

    if (current.stmt.stream)
        return null;

    const currentfunction = current.stmt.expression.schema!;
    const followUp = tpLoader.getFollowUp(currentfunction.qualifiedName);
    if (!followUp)
        return null;

    const selector = new Ast.DeviceSelector(null, followUp.schema.class!.name, null, null, []);
    const invocation = new Ast.Invocation(null, selector, followUp.schema.name, [], followUp.schema);

    const idArg = currentfunction.getArgument('id');
    const results = ctx.results!;
    const topResult = results.length > 0 ? results[0] : undefined;
    const action = C.getInvocation(current);

    if (followUp.condition) {
        let value : Ast.Value|undefined;
        if (topResult) {
            value = topResult.value[followUp.condition.name];
        } else {
            for (const param of action.in_params) {
                if (param.name === followUp.condition.name) {
                    value = param.value;
                    break;
                }
            }
        }
        if (!value)
            return null;
        if (String(value.toJS()) !== followUp.condition.value)
            return null;
    }

    const setArguments = new Set<string>();
    if (followUp.params.length > 0) {
        // find another statement with the same function and copy over the arguments we're asked to copy
        for (let idx = ctx.currentIdx!; idx >= 0; idx --) {
            const item = ctx.state.history[idx];
            if (C.isSameFunction(item.stmt.expression.schema!, followUp.schema)) {
                const action = C.getInvocation(item);
                for (const in_param of action.in_params) {
                    if (followUp.params.includes(in_param.name)) {
                        invocation.in_params.push(in_param);
                        setArguments.add(in_param.name);
                    }
                }

                break;
            }
        }
    }

    for (const followUpArg of followUp.schema.iterateArguments()) {
        if (!followUpArg.is_input)
            continue;
        if (setArguments.has(followUpArg.name))
            continue;
        if (idArg && topResult && topResult.value.id && followUpArg.type.equals(idArg.type))
            invocation.in_params.push(new Ast.InputParam(null, followUpArg.name, topResult.value.id));
        else if (followUpArg.required)
            invocation.in_params.push(new Ast.InputParam(null, followUpArg.name, new Ast.UndefinedValue(true)));
    }

    return S.addNewStatement(ctx, 'execute', null, 'accepted', new Ast.InvocationExpression(null,
        invocation, followUp.schema));
}
