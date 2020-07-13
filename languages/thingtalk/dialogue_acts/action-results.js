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

const C = require('../ast_manip');

const { SlotBag } = require('../slot_bag');
const {
    getActionInvocation,
    makeAgentReply,
    makeSimpleState,
    setOrAddInvocationParam,
    replaceAction,
} = require('../state_manip');
const {
    isInfoPhraseCompatibleWithResult
} = require('./common');

function makeThingpediaActionSuccessPhrase(ctx, info) {
    const results = ctx.results;
    if (results.length !== 1)
        return null;

    const topResult = results[0];
    if (!isInfoPhraseCompatibleWithResult(topResult, info))
        return null;

    return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_action_success', null), info);
}

function makeCompleteActionSuccessPhrase(ctx, action, info) {
    const results = ctx.results;

    // check the action is the same we actually executed, and all the parameters we're mentioning
    // match the actual parameters of the action
    assert(action instanceof Ast.Invocation);
    const ctxInvocation = getActionInvocation(ctx.current);
    if (!C.isSameFunction(ctxInvocation.schema, action.schema))
        return null;

    for (let newParam of action.in_params) {
        if (newParam.value.isUndefined)
            continue;

        let found = false;
        for (let oldParam of ctxInvocation.in_params) {
            if (newParam.name === oldParam.name) {
                if (!newParam.value.equals(oldParam.value))
                    return null;
                found = true;
                break;
            }
        }
        if (!found)
            return null;
    }

    if (info !== null) {
        if (results.length < 1)
            return null;
        assert(info instanceof SlotBag);
        const topResult = results[0];
        if (!isInfoPhraseCompatibleWithResult(topResult, info))
            return null;
    }

    return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_action_success', null), info);
}


function checkThingpediaErrorMessage(ctx, msg) {
    if (!C.isSameFunction(ctx.currentFunctionSchema, msg.bag.schema))
        return null;
    const error = ctx.error;
    if (error.isEnum && error.value !== msg.code)
        return null;

    const action = getActionInvocation(ctx.current);
    for (let in_param of action.in_params) {
        if (msg.bag.has(in_param.name) && !msg.bag.get(in_param.name).equals(in_param.value))
            return null;
    }

    return ctx;
}

function checkActionErrorMessage(ctx, action) {
    // check the action is the same we actually executed, and all the parameters we're mentioning
    // match the actual parameters of the action
    if (!C.isSameFunction(ctx.currentFunctionSchema, action.schema))
        return null;
    const ctxInvocation = getActionInvocation(ctx.current);
    for (let newParam of action.in_params) {
        if (newParam.value.isUndefined)
            continue;

        let found = false;
        for (let oldParam of ctxInvocation.in_params) {
            if (newParam.name === oldParam.name) {
                if (!newParam.value.equals(oldParam.value))
                    return null;
                found = true;
                break;
            }
        }
        if (!found)
            return null;
    }

    return ctx;
}

function makeActionErrorPhrase(ctx, questions) {
    const schema = ctx.currentFunctionSchema;
    for (let q of questions) {
        const arg = schema.getArgument(q);
        if (!arg || !arg.is_input)
            return null;
    }
    assert(Array.isArray(questions));

    if (questions.length === 0)
        return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_action_error', null));

    if (questions.length === 1) {
        const type = schema.getArgument(questions[0]).type;
        return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_action_error_question', questions), null, type);
    }
    return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_action_error_question', questions));
}

function actionErrorChangeParam(ctx, answer) {
    const schema = ctx.currentFunctionSchema;
    const questions = ctx.dialogueActParam || [];
    if (answer instanceof Ast.Value) {
        if (questions.length !== 1)
            return null;
        answer = new Ast.InputParam(null, questions[0], answer);
    }
    const arg = schema.getArgument(answer.name);
    if (!arg || !arg.is_input || !arg.type.equals(answer.value.getType()))
        return null;

    const action = getActionInvocation(ctx.current);
    if (!action)
        return null;
    const clone = action.clone();
    setOrAddInvocationParam(clone, answer.name, answer.value);
    return replaceAction(ctx, 'execute', clone, 'accepted');
}

function actionSuccessQuestion(ctx, questions) {
    for (let [qname, qtype] of questions) {
        const arg = ctx.currentFunctionSchema.getArgument(qname);
        if (!arg || arg.is_input)
            return null;
        if (qtype !== null && !qtype.equals(arg.type))
            return null;
    }
    return makeSimpleState(ctx, 'action_question', questions.map(([qname, qtype]) => qname));
}

module.exports = {
    makeThingpediaActionSuccessPhrase,
    makeCompleteActionSuccessPhrase,
    checkThingpediaErrorMessage,
    checkActionErrorMessage,
    makeActionErrorPhrase,

    actionErrorChangeParam,
    actionSuccessQuestion
};
