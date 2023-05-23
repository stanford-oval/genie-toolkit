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

import * as C from '../ast_manip';

import { SlotBag } from '../slot_bag';
import {
    ContextInfo,
    makeAgentReply,
    makeSimpleState,
} from '../state_manip';
import {
    isInfoPhraseCompatibleWithResult
} from './common';

export type ActionSuccessPhraseWithResult = [Ast.Expression|null, SlotBag];

export function actionSuccessPhraseWithResultKeyFn([expression, bag] : ActionSuccessPhraseWithResult) {
    return {
        functionName: bag.schema!.qualifiedName
    };
}

function makeThingpediaActionSuccessPhrase(ctx : ContextInfo, info : SlotBag) {
    // we don't need to check anything here, we know the context matches
    // because the generation enforces that, and we know that the result phrase
    // is correct by construction
    return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_action_success', null), info, null, { numResults: 1 });
}

function checkSelector(ctxSelector : Ast.DeviceSelector, actionSelector : Ast.DeviceSelector) : boolean {
    if (actionSelector.all !== ctxSelector.all)
        return false;

    const deviceName = ctxSelector.attributes.find((ip) => ip.name === 'name')?.value;

    if (actionSelector.attributes.length > 0 &&
        actionSelector.attributes[0].name === 'name') {
        /* we have a device name */
        assert(actionSelector.attributes[0].value instanceof Ast.StringValue);
        const actionDeviceName = actionSelector.attributes[0].value;

        if (!deviceName || !actionDeviceName.equals(deviceName))
            return false;
    }

    return true;
}

function makeCompleteActionSuccessPhrase(ctx : ContextInfo, action : Ast.Expression, info : SlotBag|null) {
    const results = ctx.results;
    assert(results);

    // check the action is the same we actually executed, and all the parameters we're mentioning
    // match the actual parameters of the action
    let last;
    if (action instanceof Ast.ChainExpression)
        last = action.last;
    else
        last = action;
    assert(last instanceof Ast.InvocationExpression);
    const ctxInvocation = C.getInvocation(ctx.current!);
    if (!C.isSameFunction(ctxInvocation.schema!, last.invocation.schema!))
        return null;
    assert(ctxInvocation instanceof Ast.Invocation);
    if (!checkSelector(ctxInvocation.selector, last.invocation.selector))
        return null;

    for (const newParam of last.invocation.in_params) {
        if (newParam.value.isUndefined)
            continue;

        let found = false, wasParamPassing = false;
        for (const oldParam of ctxInvocation.in_params) {
            assert(!oldParam.value.isUndefined); // we ran the action, so it cannot have $? params

            if (newParam.name === oldParam.name) {
                if (newParam.value instanceof Ast.VarRefValue) {
                    // we're using a join to describe this action
                    // we don't need to check that the table is correct, because
                    // the table comes from a context phrase, but do check the action
                    // is correct
                    if (oldParam.value instanceof Ast.VarRefValue) {
                        wasParamPassing = true;
                        if (newParam.value.name !== oldParam.value.name)
                            return null;
                    } else {
                        return null;
                    }
                } else {
                    // newParam is a constant, but oldParam might be a param passing
                    if (oldParam.value instanceof Ast.VarRefValue)
                        wasParamPassing = true;
                    else if (!newParam.value.equals(oldParam.value))
                        return null;
                }
                found = true;
                break;
            }
        }
        if (!found) {
            const arg = action.schema!.getArgument(newParam.name)!;
            if (arg.is_input)
                return null;

            // if newParam is an output parameter that we appended to describe the result
            // of the action, we allow it to be missing from the action, and we'll check
            // against the result entry
        }

        if (!(newParam.value instanceof Ast.VarRefValue)) {
            // if we can't check in the result bag, and we didn't find a constant
            // to check against in the program, then this phrase is no good
            // because we're hallucinating the value
            if (results.length === 0 && (!found || wasParamPassing))
                return null;
            if (results.length > 1)
                return null;

            // if the parameter is a constant, check also the result entry, if we have one
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
    }

    if (info !== null) {
        if (results.length < 1)
            return null;
        assert(info instanceof SlotBag);
        if (!results.every((r) => isInfoPhraseCompatibleWithResult(r, info)))
            return null;
    }

    return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_action_success', null), info, null, { numResults: 1 });
}

function makeGenericActionSuccessPhrase(ctx : ContextInfo) {
    return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_action_success', null), null, null, { numResults: 0 });
}

export interface ErrorMessage {
    code : string;
    bag : SlotBag;
}

function checkThingpediaErrorMessage(ctx : ContextInfo, msg : ErrorMessage) {
    if (!C.isSameFunction(ctx.currentFunction!, msg.bag.schema!))
        return null;
    const error = ctx.error;
    if (!(error instanceof Ast.EnumValue) || error.value !== msg.code)
        return null;

    const action = C.getInvocation(ctx.current!);
    for (const in_param of action.in_params) {
        if (msg.bag.has(in_param.name) && !msg.bag.get(in_param.name)!.equals(in_param.value))
            return null;
    }

    return ctx;
}

function makeActionErrorPhrase(ctx : ContextInfo, questions : C.ParamSlot[]) {
    const schema = ctx.currentFunction!;
    for (const q of questions) {
        if (!C.isSameFunction(schema, q.schema))
            return null;
        const arg = schema.getArgument(q.name);
        if (!arg || !arg.is_input)
            return null;
    }
    assert(Array.isArray(questions));

    if (questions.length === 0)
        return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_action_error', null));

    if (questions.length === 1) {
        const type = schema.getArgType(questions[0].name)!;
        return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_action_error_question', questions.map((q) => q.name)), null, type);
    }
    return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_action_error_question', questions.map((q) => q.name)));
}

export {
    makeThingpediaActionSuccessPhrase,
    makeCompleteActionSuccessPhrase,
    makeGenericActionSuccessPhrase,
    checkThingpediaErrorMessage,
    makeActionErrorPhrase,
};
