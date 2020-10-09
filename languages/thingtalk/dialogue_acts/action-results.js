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

import assert from 'assert';

import { Ast } from 'thingtalk';

import * as C from '../ast_manip';

import { SlotBag } from '../slot_bag';
const {
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

    const ctxInvocation = C.getInvocation(ctx.current);
    if (!C.isSameFunction(ctxInvocation.schema, info.schema))
        return null;

    const topResult = results[0];
    if (!isInfoPhraseCompatibleWithResult(topResult, info))
        return null;

    return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_action_success', null), info);
}

function makeCompleteActionSuccessPhrase(ctx, action, info) {
    const results = ctx.results;

    // TODO: multiple action results at once:
    // "I played Foo, Bar, and Baz for you."
    if (results.length > 1)
        return null;

    // check the action is the same we actually executed, and all the parameters we're mentioning
    // match the actual parameters of the action
    assert(action instanceof Ast.Invocation);
    const ctxInvocation = C.getInvocation(ctx.current);
    if (!C.isSameFunction(ctxInvocation.schema, action.schema))
        return null;

    for (let newParam of action.in_params) {
        if (newParam.value.isUndefined)
            continue;

        let found = false;
        for (let oldParam of ctxInvocation.in_params) {
            assert(!oldParam.value.isUndefined); // we ran the action, so it cannot have $? params

            if (newParam.name === oldParam.name) {
                // newParam is a constant, but oldParam might be a param passing
                if (!oldParam.value.isVarRef && !newParam.value.equals(oldParam.value))
                    return null;
                found = true;
                break;
            }
        }
        if (!found) {
            const arg = action.schema.getArgument(newParam.name);
            if (arg.is_input)
                return null;

            // if newParam is an output parameter that we appended to describe the result
            // of the action, we allow it to be missing from the action, and we'll check
            // against the result entry
        }

        // check also the result entry, if we have one
        // this checks that input parameters are correct, if they were parameter passed
        // and checks that the output parameters are correct
        if (results.length >= 1) {
            const topResult = results[0];
            const resultValue = topResult.value[newParam.name];
            if (!resultValue)
                return null;

            if (!resultValue.equals(newParam.value))
                return null;
        }
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

function makeGenericActionSuccessPhrase(ctx) {
    return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_action_success', null), null);
}

function checkThingpediaErrorMessage(ctx, msg) {
    if (!C.isSameFunction(ctx.currentFunctionSchema, msg.bag.schema))
        return null;
    const error = ctx.error;
    if (!error.isEnum || error.value !== msg.code)
        return null;

    const action = C.getInvocation(ctx.current);
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
    const ctxInvocation = C.getInvocation(ctx.current);
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

    const action = C.getInvocation(ctx.current);
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

export {
    makeThingpediaActionSuccessPhrase,
    makeCompleteActionSuccessPhrase,
    makeGenericActionSuccessPhrase,
    checkThingpediaErrorMessage,
    checkActionErrorMessage,
    makeActionErrorPhrase,

    actionErrorChangeParam,
    actionSuccessQuestion
};
