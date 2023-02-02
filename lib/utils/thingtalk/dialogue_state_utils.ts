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
import { APICall, getAllInvocationExpression, ifOverlap } from 'thingtalk/dist/ast';

/**
 * Normalize the #[confirm] annotation.
 *
 * #[confirm] is a three-state enum annotation with values:
 * - #[confirm=enum(confirm)]: must confirm explicitly with all parameters before the
 *   function is called (using a statement with #[confirm=enum(confirmed)] annotation)
 * - #[confirm=enum(display_result)]: the result of any query that feeds into the parameters
 *   of this function should be displayed before the function is executed; this is encoded
 *   by splitting any compound statement into two statements, executed sequentially
 * - #[confirm=enum(auto)]: the function can be called without explicit confirmation, even
 *   if some of the parameters are coming from other functions; this is the only #[confirm]
 *   that allows the function to be called multiple times in a single statement
 *
 * For legacy/ease of development reasons, if unspecified #[confirm] defaults to "confirm"
 * for actions (full confirmation before executing side effects) and "display_result" for
 * queries (splitting table joins into two statements).
 *
 * Also, #[confirm] can be specified as a boolean: "true" means "confirm" and "false" means
 * "display_result".
 */
export function normalizeConfirmAnnotation(fndef : Ast.FunctionDef) : 'confirm'|'display_result'|'auto' {
    const value = fndef.getAnnotation<boolean|string>('confirm');
    if (value === undefined) // unspecified
        return fndef.functionType === 'action' ? 'confirm' : 'display_result';

    if (typeof value === 'boolean')
        return value ? 'confirm' : 'display_result';

    assert(value === 'confirm' || value === 'display_result' || value === 'auto');
    return value;
}

export function shouldAutoConfirmStatement(stmt : Ast.ExpressionStatement) : boolean {
    let needsConfirm = false;
    const visitor = new class extends Ast.NodeVisitor {
        visitInvocation(invocation : Ast.Invocation) : boolean {
            // at this level, we only handle "confirm==confirm"
            // "confirm==display_result" is handled by the neural network, which is trained
            // to generate two separate thingtalk statements
            needsConfirm = needsConfirm || normalizeConfirmAnnotation(invocation.schema as Ast.FunctionDef) === 'confirm';
            return true;
        }
    };
    stmt.visit(visitor);
    return !needsConfirm;
}

/**
 * Compute the information that the neural network must predict to compute the new state
 * in a turn.
 *
 * This applies to either the network interpreting the user input, the one controlling the
 * dialogue policy.
 *
 * This should return a new state, roughly corresponding to the
 * delta between `oldState` and `newState`.
 * Neither `oldState` nor `newState` must be modified in-place.
 *
 * @param {ThingTalk.Ast.DialogueState|null} oldState - the previous dialogue state, before the turn
 * @param {ThingTalk.Ast.DialogueState} newState - the new state of the dialogue, after the turn
 * @param {string} forTarget - who is speaking now: either `user` or `agent`
 */
export function computePrediction(oldState : Ast.DialogueState|null, newState : Ast.DialogueState, forTarget : 'user'|'agent') : Ast.DialogueState {
    // note: we used to short-circuit the case where oldState === null
    // and directly return newState
    // this is incorrect: newState will have .confirm === 'confirmed',
    // and we need to reset it back to 'accepted' for auto-confirm statements

    // note: we explicitly do not clone annotations here
    // annotations are never exposed to the neural model and are not part of the prediction
    const deltaState = new Ast.DialogueState(null, newState.policy, newState.dialogueAct, newState.dialogueActParam, []);

    // walk forward the state of oldState and newState
    // until we find a program that is not confirmed in oldState
    // the delta starts in newState at that position

    let i = 0;

    if (oldState !== null) {
        for (i = 0; i < Math.min(oldState.history.length, newState.history.length); i++) {
            const oldItem = oldState.history[i];
            const newItem = newState.history[i];

            if (oldItem.confirm !== 'confirmed')
                break;

            if (!oldItem.equals(newItem)) {
                // console.log('----');
                // console.log(oldState.prettyprint());
                // console.log(newState.prettyprint());
                // console.log('----');
                // console.log(oldItem.prettyprint());
                // console.log(newItem.prettyprint());
                // console.log('----');
                // console.log(oldItem);
                // console.log(newItem);
                // throw new Error(`Items unexpectedly different in computing prediction`);
                break;
            }
        }
    }

    // all new state items after i are part of the delta
    deltaState.history = newState.history.slice(i).map((item) => {
        // shallow clone so we can change the "confirm" bit

        // note: we explicitly do not clone annotations here
        // annotations are never exposed to the neural model and are not part of the prediction
        // REVIEW: levenshtein needed??
        return new Ast.DialogueHistoryItem(null, item.stmt, item.results, item.confirm, null);
    });

    // check that the results is null for everything in the prediction
    // and reset confirm to false (the default) for everything autoconfirmable
    for (let i = 0; i < deltaState.history.length; i++) {
        // if (deltaState.history[i].results !== null) {
        //     console.log('----');
        //     console.log(oldState ? oldState.prettyprint() : 'null');
        //     console.log(newState.prettyprint());
        //     console.log('----');
        //     console.log(deltaState.history[i].prettyprint());
        //     console.log('----');
        //     throw new Error(`Item unexpectedly has results in prediction`);
        // }

        if (forTarget === 'user' && shouldAutoConfirmStatement(deltaState.history[i].stmt))
            deltaState.history[i].confirm = 'accepted';
    }

    return deltaState;
}

/**
 * Maximum number of history items with results that we keep.
 *
 * This ensures that the context size does not grow indefinitely.
 */
const MAX_CONTEXT_ITEMS = 5;

export function computeNewState(state : Ast.DialogueState|null, prediction : Ast.DialogueState, forTarget : 'user'|'agent', evaluateDialog ?: boolean) {
    if (evaluateDialog) {
        const clone = new Ast.DialogueState(null, prediction.policy, prediction.dialogueAct, prediction.dialogueActParam, []);

        // append all history elements that were confirmed
        if (state !== null) {
            for (const oldItem of state.history) {
                if (oldItem.confirm !== 'confirmed')
                    break;
                const new_oldItem = oldItem.clone();
                new_oldItem.levenshtein = null;
                clone.history.push(new_oldItem);
            }
        }
    
        // append the prediction items
        // when evaluating slots, get rid of all levenshteins
        for (const i of prediction.history) {
            const new_i = i.clone();
            new_i.levenshtein = null;
            clone.history.push(new_i);
        }
        return clone;
    }
    const clone = new Ast.DialogueState(null, prediction.policy, prediction.dialogueAct, prediction.dialogueActParam, [], {
        nl: state?.nl_annotations,
        impl: state?.impl_annotations,
    });

    // append items that are accepted (user-initiated commands that need to be slot filled)
    //                   and confirmed (ready-to-execute commands)
    // for accepted ones, we keep at most one outstanding item per domain
    // domain currently defined as the last part of the ChainExpression
    // the algorithm works in the following way:
    // we iterate through the history of the old state (begin from the top of the stack)
    // for anything confirmed, we retain them
    // for accepted, we check if they have appeared in `existingDomains`
    // if not, add to it.
    // if yes, skip
    // NOTE: we discard all proposed in this function. If they have not been accepted, they are discarded.
    if (state !== null) {
        const existingDomains : APICall[][] = [];
        // .slice() is to create a copy so not to modify in-place
        // .reverse() is to iterate from top of stack to bottom, and the result will also be reversed
        for (const oldItem of state.history.slice().reverse()) {
            if (oldItem.confirm === 'confirmed') {
                clone.history.push(oldItem);
            } else if (oldItem.confirm === 'accepted') {
                const oldItemInv = getAllInvocationExpression(oldItem.stmt.expression.last);
                let found = false;
                for (const i of existingDomains) {
                    if (ifOverlap(i, oldItemInv)) {
                        found = true;
                        break;
                    }
                }
                if (found)
                    continue;
                existingDomains.push(oldItemInv);
                clone.history.push(oldItem);
            }
        }
    }
    clone.history.reverse();

    // slice to the last MAX_CONTEXT_ITEMS items
    if (clone.history.length > MAX_CONTEXT_ITEMS)
        clone.history = clone.history.slice(clone.history.length - MAX_CONTEXT_ITEMS, clone.history.length);

    // append the prediction items
    clone.history.push(...prediction.history);
    return clone;
}

/**
 * Maximum number of history items with results to include in the
 * context passed to the neural model.
 *
 * This controls how much information is carried from the context
 * and also the maximum length of the sequence.
 */
const MAX_NEURAL_CONTEXT_ITEMS = 5;

export function prepareContextForPrediction(context : Ast.DialogueState|null, forTarget : 'user'|'agent') : Ast.DialogueState|null {
    if (context === null)
        return null;
    // note: we explicitly do not clone annotations here
    // annotations are never exposed to the neural model
    const clone = new Ast.DialogueState(null, context.policy, context.dialogueAct, context.dialogueActParam, []);

    // walk through all items in the history, find the last in each sequence of "compatible" item with results

    let i, lastItems = [];
    for (i = 0; i < context.history.length; i++) {
        const item = context.history[i];
        if (item.results === null)
            break;
        if (lastItems.length > 0 && item.compatible(lastItems[lastItems.length-1]))
            lastItems[lastItems.length-1] = item;
        else
            lastItems.push(item);
    }

    // include at most the last {MAX_CONTEXT_ITEMS} items, or we'll run out of context length
    if (lastItems.length > MAX_NEURAL_CONTEXT_ITEMS)
        lastItems = lastItems.slice(lastItems.length - MAX_NEURAL_CONTEXT_ITEMS, lastItems.length);

    // add a copy of the last items with results
    // trim the result list to 1 or 3
    // trim arrays in each result so they have at most 3 items
    for (const lastItem of lastItems) {
        // clone
        const cloneItem = lastItem.clone();

        // remove annotations
        // annotations are never exposed to the neural model
        cloneItem.nl_annotations = {};
        cloneItem.impl_annotations = {};

        if (forTarget === 'user' && cloneItem.results!.results.length > 1)
            cloneItem.results!.results.length = 1;
        else if (cloneItem.results!.results.length > 3)
            cloneItem.results!.results.length = 3;

        for (const result of cloneItem.results!.results) {
            for (const key in result.value) {
                const value = result.value[key];
                if (value instanceof Ast.ArrayValue && value.value.length > 3) {
                    // FIXME workaround a bug in the implementation of Ast.DialogueHistoryResultItem.clone
                    // https://github.com/stanford-oval/thingtalk/issues/364
                    const clone = value.clone();
                    clone.value.length = 3;
                    result.value[key] = clone;
                }
            }
        }

        clone.history.push(cloneItem);
    }

    // append the unconfirmed/unexecuted results
    for (; i < context.history.length; i++) {
        const item = context.history[i];
        // assert(item.results === null);

        // about this assertion:
        //
        // on the agent side, we just executed the state, so all confirmed statements
        // must have results
        //
        // on the user side, the agent just spoke; the agent never introduces confirmed statements,
        // because statements must be confirmed by the user, so this assertion is also true
        //
        // note that there is a tricky edge case here: the user issued a confirmation
        // (an explicitly confirmed statement) but the agent is making a request
        // using dlg.ask() in the middle of prepareForExecution()
        // in that case, this assertion would not be correct
        // we still leave it here because with the current state machine the above
        // case cannot happen: the agent will fill all the missing slots before
        // asking for the final confirmation, and the user will not reply with
        // a "confirmed" item unless the agent is in sys_confirm_action state
        // this assertion has caught other problems in the past
        // assert(item.confirm !== 'confirmed');

        // note: we explicitly do not clone annotations here
        // annotations are never exposed to the neural model
        // REVIEW: Levenshtein needed?
        const cloneItem = new Ast.DialogueHistoryItem(item.location, item.stmt, item.results, item.confirm, item.levenshtein);
        clone.history.push(cloneItem);
    }

    return clone;
}
