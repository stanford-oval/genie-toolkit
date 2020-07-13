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

function isExecutable(stmt) {
    let hasUndefined = false;
    const visitor = new class extends Ast.NodeVisitor {
        visitInvocation(invocation) {
            const requireEither = invocation.schema.getAnnotation('require_either');
            if (requireEither) {
                const params = new Set;
                for (let in_param of invocation.in_params)
                    params.add(in_param.name);

                for (let requirement of requireEither) {
                    let satisfied = false;
                    for (let option of requirement) {
                        if (params.has(option)) {
                            satisfied = true;
                            break;
                        }
                    }
                    if (!satisfied)
                        hasUndefined = true;
                }
            }

            return true;
        }

        visitValue(value) {
            if (value.isUndefined)
                hasUndefined = true;
            return true;
        }
    };
    stmt.visit(visitor);
    return !hasUndefined;
}

function shouldAutoConfirmStatement(stmt) {
    if (stmt.isRule)
        return false;

    let needsConfirm = false;
    const visitor = new class extends Ast.NodeVisitor {
        visitInvocation(value) {
            if (value.schema.annotations.confirm)
                needsConfirm = needsConfirm || value.schema.annotations.confirm.toJS();
            else
                needsConfirm = needsConfirm || value.schema.functionType === 'action';
            return true;
        }
    };
    stmt.visit(visitor);
    return !needsConfirm;
}

function computePrediction(oldState, newState, forTarget) {
    // note: we used to short-circuit the case where oldState === null
    // and directly return newState
    // this is incorrect: newState will have .confirm === 'confirmed',
    // and we need to reset it back to 'accepted' for auto-confirm statements

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
                console.log(oldItem.prettyprint());
                console.log(newItem.prettyprint());
            }
            assert(oldItem.equals(newItem));
        }
    }

    // all new state items after i are part of the delta
    deltaState.history = newState.history.slice(i).map((item) => {
        // shallow clone so we can change the "confirm" bit
        return new Ast.DialogueHistoryItem(null, item.stmt, item.results, item.confirm);
    });

    // check that the results is null for everything in the prediction
    // and reset confirm to false (the default) for everything autoconfirmable
    for (let i = 0; i < deltaState.history.length; i++) {
        assert(deltaState.history[i].results === null);

        if (forTarget === 'user' && shouldAutoConfirmStatement(deltaState.history[i].stmt))
            deltaState.history[i].confirm = 'accepted';
    }

    return deltaState;
}

function computeNewState(state, prediction, forTarget) {
    const clone = new Ast.DialogueState(null, prediction.policy, prediction.dialogueAct, prediction.dialogueActParam, []);

    // append all history elements that were confirmed
    if (state !== null) {
        for (let oldItem of state.history) {
            if (oldItem.confirm !== 'confirmed')
                break;
            clone.history.push(oldItem);
        }
    }

    const autoConfirm = forTarget === 'user';
    // append the prediction items, and set the confirm bit if necessary
    for (let newItem of prediction.history) {
        let cloneItem = newItem;
        if (cloneItem.confirm === 'accepted' && autoConfirm && isExecutable(cloneItem.stmt) && shouldAutoConfirmStatement(cloneItem.stmt)) {
            // shallow clone
            cloneItem = new Ast.DialogueHistoryItem(null, cloneItem.stmt, cloneItem.results, cloneItem.confirm);
            cloneItem.confirm = 'confirmed';
        }
        clone.history.push(cloneItem);
    }

    return clone;
}

function prepareContextForPrediction(context, forTarget) {
    if (context === null)
        return null;
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

    // include at most the last 3 last items, or we'll run out of context length
    if (lastItems.length > 3)
        lastItems = lastItems.slice(lastItems.length-3, lastItems.length);

    // add a copy of the last items with results, and trim the result list to 1 or 3
    for (let lastItem of lastItems) {
        // semi-shallow clone
        const cloneItem = new Ast.DialogueHistoryItem(null, lastItem.stmt, new Ast.DialogueHistoryResultList(null, lastItem.results.results.slice(),
            lastItem.results.count, lastItem.results.more, lastItem.results.error), lastItem.confirm);
        if (forTarget === 'user' && cloneItem.results.results.length > 1)
            cloneItem.results.results.length = 1;
        else if (cloneItem.results.results.length > 3)
            cloneItem.results.results.length = 3;
        clone.history.push(cloneItem);
    }

    // append the unconfirmed/unexecuted results
    for (; i < context.history.length; i++) {
        const item = context.history[i];
        assert(item.results === null);

        // about this assertion:
        //
        // on the agent side, we just executed the state, so all confirmed statements
        // must have results
        //
        // on the user side, the agent just spoke; the agent never introduces confirmed statements,
        // because statements must be confirmed by the user, so this assertion is also true
        assert(item.confirm !== 'confirmed');

        clone.history.push(item);
    }

    return clone;
}

module.exports = {
    isExecutable,
    shouldAutoConfirmStatement,

    computePrediction,
    computeNewState,
    prepareContextForPrediction,
};
