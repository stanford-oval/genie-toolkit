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

import { Ast } from 'thingtalk';
import { adjustDefaultParameters } from './ast-utils';

/**
 * Construct an agent or user target that only change the dialogue act.
 *
 * The resulting agent target carries over all the accepted items and not executed items
 * from the current state.
 */
export function makeSimpleState(state : Ast.DialogueState|null, policyName : string, dialogueAct : string, dialogueActParam : Array<string|Ast.Value>|null = null) {
    const newState = new Ast.DialogueState(null, policyName, dialogueAct, dialogueActParam, []);
    if (state === null)
        return newState;

    for (let i = 0; i < state.history.length; i++) {
        if (state.history[i].confirm === 'proposed' || state.history[i].results !== null)
            continue;
        newState.history.push(state.history[i]);
    }

    return newState;
}


class CollectDeviceIDVisitor extends Ast.NodeVisitor {
    collection = new Map<string, string>();

    visitDeviceSelector(selector : Ast.DeviceSelector) {
        if (selector.all) {
            this.collection.set(selector.kind, 'all');
            return false;
        }
        if (!selector.id)
            return false;
        this.collection.set(selector.kind, selector.id);
        return false;
    }
}

class ApplyDeviceIDVisitor extends Ast.NodeVisitor {
    constructor(private collection : Map<string, string>) {
        super();
    }

    visitDeviceSelector(selector : Ast.DeviceSelector) {
        if (selector.attributes.length > 0 || selector.all)
            return false;
        if (selector.id)
            return false;

        const existing = this.collection.get(selector.kind);
        if (existing === 'all')
            selector.all = true;
        else if (existing)
            selector.id = existing;
        return false;
    }
}

/**
 * Return the index of the last executed item (the current item) in the dialogue state.
 *
 * @param state
 * @returns
 */
function getCurrentIdx(state : Ast.DialogueState) {
    let currentIdx = -1;
    for (let idx = 0; idx < state.history.length; idx++) {
        if (state.history[idx].results !== null)
            currentIdx = idx;
    }
    return currentIdx;
}

function propagateDeviceIDs(state : Ast.DialogueState,
                            currentIdx : number,
                            newHistoryItems : Ast.DialogueHistoryItem[]) {
    const visitor = new CollectDeviceIDVisitor();

    // here we used to traverse the whole state and collect all device IDs from
    // all turns
    // this is not correct though: we cannot propagate a device ID older
    // than MAX_CONTEXT_ITEMS ago because it won't be seen in the neural context
    //
    // instead, we only ask the neural model to propagate the current item, if we have
    // it, and any item newer than that
    // propagation from older item will happen in prepareForExecution
    //
    // we need to have the neural model propagate from the next item and subsequent
    // because next items are replaced and gone before prepareForExecution so the
    // info has to be carried forward by the neural model output
    if (currentIdx >= 0)
        state.history[currentIdx].visit(visitor);
    for (let i = currentIdx+1; i < state.history.length; i++)
        state.history[i].visit(visitor);

    const applyVisitor = new ApplyDeviceIDVisitor(visitor.collection);
    return newHistoryItems.map((item) => {
        // clone the item just to be sure
        // FIXME we might be able to skip this clone in some cases
        item = item.clone();
        item.visit(applyVisitor);
        return item;
    });
}

/**
 * Create a new dialogue state that corresponds to adding add one or more
 * new dialogue history items to the given state.
 *
 * The function will return a new dialogue state, suitable for representing
 * the meaning of one user or agent turn.
 *
 * @param state the existing state
 * @param dialogueAct the new dialogue act to use
 * @param dialogueActParam parameters to the dialogue act, if any
 * @param confirm how the new items are to be confirmed
 * @param newHistoryItem the items that are being added
 * @returns
 */
export function makeTargetState(state : Ast.DialogueState,
                                policy : string,
                                dialogueAct : string,
                                dialogueActParam : Array<string|Ast.Value>,
                                confirm : 'accepted-query'|'accepted'|'proposed'|'proposed-query'|'confirmed',
                                ...newHistoryItem : Ast.DialogueHistoryItem[]) : Ast.DialogueState {
    const currentIdx = getCurrentIdx(state);
    newHistoryItem = propagateDeviceIDs(state, currentIdx, newHistoryItem);

    for (const item of newHistoryItem) {
        adjustDefaultParameters(item);
        item.results = null;
        item.confirm = confirm === 'accepted-query' ? 'accepted' :
            confirm  === 'proposed-query' ? 'proposed' : confirm;
    }

    const newState = new Ast.DialogueState(null, policy, dialogueAct, dialogueActParam.length ? dialogueActParam : null /* FIXME */, []);

    if (confirm === 'proposed') {
        // find the first item that was not confirmed or accepted, and replace everything after that

        for (let i = 0; i < state.history.length; i++) {
            if (state.history[i].confirm === 'proposed')
                break;
            if (state.history[i].results !== null)
                continue;
            newState.history.push(state.history[i]);
        }
        newState.history.push(...newHistoryItem);
    } else if (confirm === 'accepted-query' || confirm === 'proposed-query') {
        // add the new history item right after the current one, keep
        // all the accepted items, and remove all proposed items

        //if (currentIdx >= 0) {
        //    for (let i = 0; i <= currentIdx; i++)
        //        newState.history.push(state.history[i]);
        //}
        newState.history.push(...newHistoryItem);
        if (currentIdx >= 0) {
            for (let i = currentIdx + 1; i < state.history.length; i++) {
                if (state.history[i].confirm === 'proposed')
                    continue;
                newState.history.push(state.history[i]);
            }
        }
    } else {
        // wipe everything from state after the current program
        // this will remove all previously accepted and/or proposed actions
        //if (currentIdx >= 0) {
        //    for (let i = 0; i <= currentIdx; i++)
        //        newState.history.push(state.history[i]);
        //}
        newState.history.push(...newHistoryItem);
    }

    return newState;
}

/**
 * Create a new dialogue state that corresponds to adding add one or more
 * new expression statements to the given state.
 *
 * This function is equivalent to {@link makeTargetState} but uses {@link Ast.Expression}
 * instead of {@link Ast.DialogueHistoryItem}.
 */
export function addNewStatement(state : Ast.DialogueState,
                                policy : string,
                                dialogueAct : string,
                                dialogueActParam : Array<string|Ast.Value>,
                                confirm : 'accepted'|'proposed'|'confirmed',
                                ...newExpression : Ast.Expression[]) {
    const newItems = newExpression.map((expr) =>
        new Ast.DialogueHistoryItem(null, new Ast.ExpressionStatement(null, expr), null, confirm));
    return makeTargetState(state, policy, dialogueAct, dialogueActParam, confirm, ...newItems);
}
