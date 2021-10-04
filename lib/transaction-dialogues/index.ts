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
import { Ast } from 'thingtalk';

import { ContextTable } from '../sentence-generator/types';
import ThingpediaLoader from '../templates/load-thingpedia';
import * as C from '../templates/ast_manip';
import { StateM } from '../utils/thingtalk';

import * as S from './state_manip';
import * as D from './dialogue_acts';

export * as Templates from './templates/index.genie.out';
import { $load } from './templates/index.genie.out';
import { DialogueInterface } from '../thingtalk-dialogues/interface';
import { PolicyStartMode, UnexpectedCommandError } from '../thingtalk-dialogues';
import { ContextInfo } from './context-info';
export {
    $load as initializeTemplates
};
export * from './metadata';
import { POLICY_NAME } from './metadata';
import { makeContextPhrase } from './context-phrases';

/**
 * This module defines the basic logic of transaction dialogues: how
 * the dialogue is started, how the agent handles each state, and how
 * the agent follows up.
 */

function greet(dlg : DialogueInterface) {
    dlg.say(dlg._("{hello|hi}{!|,} {how can i help you|what are you interested in|what can i do for you}?"),
        StateM.makeSimpleState(dlg.state, POLICY_NAME, 'sys_greet'));
}

/**
 * The main entrypoint of the dialogue.
 *
 * @param dlg the interface to use to interact with the user
 */
export async function policy(dlg : DialogueInterface, startMode : PolicyStartMode) {
    // TODO call "expect" here a bunch of times to register the templates
    dlg.expect([
        ["TODO user", {}, (state) => StateM.makeSimpleState(state, POLICY_NAME, 'cancel')]
    ]);

    switch (startMode) {
    case PolicyStartMode.NORMAL:
        greet(dlg);
        break;
    case PolicyStartMode.NO_WELCOME:
        break;
    case PolicyStartMode.RESUME:
        throw new Error('TODO resume existing dialogue');
        break;
    case PolicyStartMode.USER_FIRST_TIME:
        throw new Error(`first time for the user`);
        break;
    }

    for (;;) {
        try {
            const cmd = await dlg.get({
                expecting: null,

                acceptActs: ['*'],
                acceptQueries: ['*'],
                acceptActions: ['*']
            });

            // execute the command immediately regardless of dialogue act
            // this will update dlg.state to the dialogue state after the user speaks
            await dlg.execute(cmd.meaning);
            const ctx = ContextInfo.get(dlg.state);

            switch (cmd.type) {
            case POLICY_NAME + '.greet':
                greet(dlg);
                break;

            case POLICY_NAME + '.cancel':
                dlg.say(dlg._("alright, let me know if I can help you with anything else!"), StateM.makeSimpleState(ctx.state, POLICY_NAME, 'sys_end'));
                return;

            default:
                // all other cases
                dlg.say(dlg._("TODO agent"), StateM.makeSimpleState(ctx.state, POLICY_NAME, 'sys_todo'));
            }
        } catch(e) {
            if (!(e instanceof UnexpectedCommandError))
                throw e;

            dlg.say(dlg._("Sorry, I did not understand that. Can you rephrase it?"), StateM.makeSimpleState(dlg.state, POLICY_NAME, 'sys_unexpected'));
        }
    }
}

/**
 * Extract all the relevant context phrases for the given state.
 *
 * The context phrases will be used to generate the agent reply,
 * and are mapped to the context non-terminals defined in templates/index.genie.
 */
export function getContextPhrasesForState(state : Ast.DialogueState|null,
                                          tpLoader : ThingpediaLoader,
                                          contextTable : ContextTable) {
    if (state === null)
        return [makeContextPhrase(contextTable.ctx_init, ContextInfo.initial())];

    assert(state instanceof Ast.DialogueState, `expected a dialogue state Ast node`);
    if (state.policy !== POLICY_NAME)
        return [];
    const ctx = ContextInfo.get(state);
    // get the main context tags for this context (the abstract state, in paper terminology)
    const tags = S.tagContextForAgent(ctx, contextTable);

    const phrases = tags.map((tag) => makeContextPhrase(tag, ctx));
    // add auxiliary context non-terminals used for pruning and to simplify generation
    phrases.push(...S.getAgentContextPhrases(ctx, tpLoader, contextTable));
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
    const ctx = ContextInfo.get(state);

    // if the agent proposed something and the user says "yes", we accept the proposal
    if (state.history.length > 0 && state.history[state.history.length-1].confirm === 'proposed'
        && answer instanceof Ast.BooleanValue) {
        if (answer.value) // yes accepts
            return D.acceptAllProposedStatements(state);
        else // no is cancel
            return StateM.makeSimpleState(state, POLICY_NAME, 'cancel');
    }

    switch (state.dialogueAct) {
    case 'sys_record_command':
        return StateM.makeSimpleState(state, POLICY_NAME, 'end');

    case 'sys_anything_else':
        if (answer instanceof Ast.BooleanValue) {
            if (answer.value)
                return StateM.makeSimpleState(state, POLICY_NAME, 'reinit');
            else
                return StateM.makeSimpleState(state, POLICY_NAME, 'end');
        }
        return null;
    case 'sys_recommend_one':
    case 'sys_recommend_two':
    case 'sys_recommend_three':
    case 'sys_recommend_four':
        // "yes" to a recommendation (without a proposed action) is an answer to
        // "would you like to learn more"
        if (answer instanceof Ast.BooleanValue && answer.value === true)
            return StateM.makeSimpleState(state, POLICY_NAME, 'learn_more');
        // fallthrough
    case 'sys_display_result':
        // "no" to a recommendation or display result is cancel
        if (answer instanceof Ast.BooleanValue && answer.value === false)
            return StateM.makeSimpleState(state, POLICY_NAME, 'cancel');
        return null;

    case 'sys_slot_fill':
        return D.impreciseSlotFillAnswer(ctx, tpLoader, answer);
    case 'sys_search_question':
        return D.impreciseSearchQuestionAnswer(ctx, tpLoader, answer);
    case 'sys_confirm_action':
        if (answer instanceof Ast.BooleanValue) {
            if (answer.value)
                return D.actionConfirmAcceptPhrase(ctx);
            else
                return D.actionConfirmRejectPhrase(ctx);
        }
        return null;
    case 'sys_resolve_contact':
    case 'sys_resolve_device':
    case 'sys_ask_phone_number':
    case 'sys_ask_email_address':
    case 'sys_resolve_location':
    case 'sys_resolve_time':
    case 'sys_configure_notifications':
        return StateM.makeSimpleState(state, POLICY_NAME, 'answer', [answer]);
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

    return new Ast.DialogueState(null, POLICY_NAME, 'notification', appName ? [new Ast.Value.String(appName)] : null,
        [new Ast.DialogueHistoryItem(null, stmt, new Ast.DialogueHistoryResultList(null, [result], new Ast.NumberValue(1), false), 'confirmed')]);
}

export function notifyError(appName : string|null, program : Ast.Program, error : Ast.Value) {
    assert(program.statements.length === 1);
    const stmt = program.statements[0];
    assert(stmt instanceof Ast.ExpressionStatement);

    return new Ast.DialogueState(null, POLICY_NAME, 'notification', appName ? [new Ast.Value.String(appName)] : null,
        [new Ast.DialogueHistoryItem(null, stmt, new Ast.DialogueHistoryResultList(null, [], new Ast.NumberValue(1), false, error), 'confirmed')]);
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
    return new Ast.DialogueState(null, POLICY_NAME, 'init', null, [new Ast.DialogueHistoryItem(null, stmt, null, 'accepted')]);
}

/**
 * Compute a possible agent follow up to the given state.
 *
 * @deprecated This function is bad and needs to be refactored out.
 */
export function getFollowUp(state : Ast.DialogueState,
                            tpLoader : ThingpediaLoader,
                            contextTable : ContextTable) {
    const ctx = ContextInfo.get(state);
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

    return StateM.addNewStatement(ctx.state, POLICY_NAME, 'execute', [], 'accepted', new Ast.InvocationExpression(null,
        invocation, followUp.schema));
}
