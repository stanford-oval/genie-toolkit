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
    makeAgentReply,
    makeSimpleState,
    setOrAddInvocationParam,
    addNewItem,
} from '../state_manip';


function makeActionConfirmationPhrase(ctx : ContextInfo) {
    return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_confirm_action', null), null, Type.Boolean);
}

function actionConfirmAcceptPhrase(ctx : ContextInfo) {
    const clone = ctx.clone();
    assert(clone.next!.confirm === 'accepted');
    clone.next!.confirm = 'confirmed';
    clone.state.dialogueAct = 'execute';
    clone.state.dialogueActParam = null;
    return clone.state;
}

function actionConfirmRejectPhrase(ctx : ContextInfo) {
    const clone = ctx.clone();
    clone.next!.confirm = 'proposed';
    return makeSimpleState(clone, 'cancel', null);
}

function actionConfirmChangeParam(ctx : ContextInfo, answer : Ast.Value|C.InputParamSlot) {
    if (!ctx.next)
        return null;

    if (answer instanceof Ast.Value)
        return null;

    // don't accept in params that don't apply to this specific action
    const arg = ctx.nextFunction!.getArgument(answer.ast.name);
    if (!arg || !arg.is_input || !arg.type.equals(answer.ast.value.getType()))
        return null;

    const clone = ctx.next.clone();
    const action = C.getInvocation(clone);
    if (!action) return null;

    setOrAddInvocationParam(action, answer.ast.name, answer.ast.value);
    return addNewItem(ctx, 'execute', null, 'confirmed', clone);
}

export {
    makeActionConfirmationPhrase,
    actionConfirmAcceptPhrase,
    actionConfirmRejectPhrase,
    actionConfirmChangeParam
};
