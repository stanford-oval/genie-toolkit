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

import { Type } from 'thingtalk';

import {
    ContextInfo,
    makeAgentReply,
    makeSimpleState,
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

export {
    makeActionConfirmationPhrase,
    actionConfirmAcceptPhrase,
    actionConfirmRejectPhrase,
};
