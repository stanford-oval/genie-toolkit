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
    mergeParameters,
    addNewItem,
} from '../state_manip';

function isGoodSlotFillQuestion(ctx : ContextInfo, question : C.ParamSlot) {
    for (const slot of ctx.nextInfo!.missingSlots) {
        const schema = slot.primitive?.schema;
        if (!schema)
            continue;
        if (C.isSameFunction(question.schema, schema))
            return slot.tag === `in_param.${question.name}`;
    }
    return false;
}

function areGoodSlotFillQuestions(ctx : ContextInfo, questions : C.ParamSlot[]) {
    return questions.every((q) => isGoodSlotFillQuestion(ctx, q));
}

function useRawModeForSlotFill(arg : Ast.ArgumentDef) {
    // raw mode bypasses _all_ natural language understanding
    // it is used to take in free-form inputs like messages or titles

    const type = arg.type;
    if (!type.isString)
        return false;

    // if the developer specified what to do for the argument, it is authoritative
    const annotation = arg.getAnnotation<boolean>('raw_mode');
    if (annotation !== undefined)
        return annotation;

    // use raw mode for free-form text parameters
    const stringvalues = arg.getAnnotation<string>('string_values');
    if (!stringvalues)
        return false;
    return ['tt:short_free_text', 'tt:long_free_text'].includes(stringvalues);
}


function makeSlotFillQuestion(ctx : ContextInfo, questions : C.ParamSlot[]) {
    if (!areGoodSlotFillQuestions(ctx, questions))
        return null;

    assert(questions.length > 0);
    if (questions.length === 1) {
        const slot = ctx.nextInfo!.missingSlots.find((slot) => slot.tag === `in_param.${questions[0].name}`);
        assert(slot);
        const raw = !!slot.arg && useRawModeForSlotFill(slot.arg);
        return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_slot_fill', [questions[0].name]), null, slot.type, { raw });
    }
    return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_slot_fill', questions.map((q) => q.name)));
}

/**
 * Check if the action has parameters for the `questions`
 */
function isSlotFillAnswerValidForQuestion(action : Ast.Invocation, questions : string[]) {
    assert(Array.isArray(questions));
    assert(action instanceof Ast.Invocation);
    return questions.every((question) => {
        for (const in_param of action.in_params) {
            if (in_param.name === question)
                return !in_param.value.isUndefined;
        }
        return false;
    });
}

function fastSemiShallowClone(item : Ast.DialogueHistoryItem) {
    const newExpressions = [];
    const oldExpressions = item.stmt.expression.expressions;
    for (let i = 0; i < oldExpressions.length-1; i++)
        newExpressions.push(oldExpressions[i]);
    // deep clone only the last expression
    newExpressions.push(oldExpressions[oldExpressions.length-1].clone());
    const newStmt = new Ast.ExpressionStatement(null,
        new Ast.ChainExpression(null, newExpressions, item.stmt.expression.schema));

    return new Ast.DialogueHistoryItem(null, newStmt, null, 'accepted');
}

function preciseSlotFillAnswer(ctx : ContextInfo, answer : Ast.Invocation) {
    const questions = ctx.state.dialogueActParam as string[];
    assert(Array.isArray(questions) && questions.length > 0 && questions.every((q) => typeof q === 'string'));
    if (!isSlotFillAnswerValidForQuestion(answer, questions))
        return null;
    if (!C.isSameFunction(answer.schema!, ctx.nextFunction!))
        return null;
    assert(answer instanceof Ast.Invocation);
    assert(ctx.next && ctx.nextInfo);

    // check that we don't fill the chain parameter through this path:
    // the chain parameter can only be filled if the agent shows the results
    for (const in_param of answer.in_params) {
        if (in_param.name === ctx.nextInfo.chainParameter &&
            !ctx.nextInfo.chainParameterFilled)
            return null;
    }

    const clone = fastSemiShallowClone(ctx.next);
    const newInvocation = C.getInvocation(clone);
    assert(newInvocation instanceof Ast.Invocation);
    assert(C.isSameFunction(newInvocation.schema!, answer.schema!));
    // modify in place
    mergeParameters(newInvocation, answer);

    return addNewItem(ctx, 'execute', null, 'accepted', clone);
}

function impreciseSlotFillAnswer(ctx : ContextInfo, answer : Ast.Value|C.InputParamSlot) {
    const questions = ctx.state.dialogueActParam as string[];
    assert(Array.isArray(questions) && questions.length > 0 && questions.every((q) => typeof q === 'string'));
    if (questions.length !== 1)
        return null;

    assert(ctx.next && ctx.nextInfo);

    let ipslot : C.InputParamSlot;
    if (answer instanceof Ast.Value) {
        assert(questions.length === 1);

        const slot = ctx.nextInfo!.missingSlots.find((slot) => slot.tag === `in_param.${questions[0]}`);
        assert(slot);
        const ptype = slot.type;

        if (ptype instanceof Type.Array && !(answer instanceof Ast.ArrayValue)) {
            const elem = ptype.elem as Type;

            if (elem === Type.Date && answer.getType() === Type.Time)
                answer = C.makeDateWithDateTime(null, answer);

            answer = new Ast.ArrayValue([answer]);
        } else {
            if (ptype === Type.Date && answer.getType() === Type.Time)
                answer = C.makeDateWithDateTime(null, answer);
        }

        if (!Type.isAssignable(answer.getType(), ptype, {}, ctx.loader.entitySubTypeMap))
            return null;
        ipslot = {
            schema: slot.primitive!.schema!,
            ptype: ptype,
            ast: new Ast.InputParam(null, questions[0], answer)
        };
    } else {
        ipslot = answer;
        if (!questions.some((q) => q === ipslot.ast.name))
            return null;
        if (!C.isSameFunction(answer.schema, ctx.nextFunction!))
            return null;
    }

    if (ipslot.ast.name === ctx.nextInfo.chainParameter)
        return null;

    // modify in place
    const clone = ctx.next.clone();
    for (const slot of clone.iterateSlots2()) {
        if (slot instanceof Ast.DeviceSelector)
            continue;
        const schema = slot.primitive?.schema;
        if (!schema || !C.isSameFunction(schema, ipslot.schema))
            continue;
        if (slot.tag !== `in_param.${ipslot.ast.name}`)
            continue;
        if (!(slot.get() instanceof Ast.UndefinedValue))
            continue;

        slot.set(ipslot.ast.value);
    }
    return addNewItem(ctx, 'execute', null, 'accepted', clone);
}

export {
    makeSlotFillQuestion,

    preciseSlotFillAnswer,
    impreciseSlotFillAnswer
};
