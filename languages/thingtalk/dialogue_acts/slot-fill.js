// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const C = require('../ast_manip');

const {
    getActionInvocation,
    makeAgentReply,
    makeSimpleState,
    replaceAction,
} = require('../state_manip');
const {
    addParametersFromContext
} = require('./common');


function isGoodSlotFillQuestion(ctx, questions) {
    const action = getActionInvocation(ctx.next);
    assert(action instanceof Ast.Invocation);
    for (let q of questions) {
        if (q === ctx.nextInfo.chainParameter)
            return null;
        const arg = action.schema.getArgument(q);
        if (!arg || !arg.is_input)
            return false;
        for (let in_param of action.in_params) {
            if (in_param.name === q && !in_param.value.isUndefined)
                return false;
        }
    }
    return true;
}

function makeSlotFillQuestion(ctx, questions) {
    if (!isGoodSlotFillQuestion(ctx, questions))
        return null;

    assert(questions.length > 0);
    if (questions.length === 1) {
        const action = getActionInvocation(ctx.next);
        const type = action.schema.getArgument(questions[0]).type;
        return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_slot_fill', questions), null, type);
    }
    return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_slot_fill', questions));
}

/**
 * Check if the action has parameters for the `questions`
 */
function isSlotFillAnswerValidForQuestion(action, questions) {
    assert(Array.isArray(questions));
    assert(action instanceof Ast.Invocation);
    return questions.every((question) => {
        for (let in_param of action.in_params) {
            if (in_param.name === question)
                return !in_param.value.isUndefined;
        }
        return false;
    });
}

function preciseSlotFillAnswer(ctx, answer) {
    const questions = ctx.state.dialogueActParam;
    if (!isSlotFillAnswerValidForQuestion(answer, questions))
        return null;

    const answerFunctions = C.getFunctionNames(answer);
    assert(answerFunctions.length === 1);
    if (answerFunctions[0] !== ctx.nextFunction)
        return null;
    if (!isGoodSlotFillQuestion(ctx, questions))
        return null;
    assert(answer instanceof Ast.Invocation);
    addParametersFromContext(answer, getActionInvocation(ctx.next));

    // check that we don't fill the chain parameter through this path:
    // the chain parameter can only be filled if the agent shows the results
    for (let in_param of answer.in_params) {
        if (in_param.name === ctx.nextInfo.chainParameter &&
            !ctx.nextInfo.chainParameterFilled)
            return null;
    }

    return replaceAction(ctx, 'execute', answer, 'accepted');
}

function impreciseSlotFillAnswer(ctx, answer) {
    const questions = ctx.state.dialogueActParam;
    assert(Array.isArray(questions));
    if (questions.length !== 1)
        return null;

    if (answer instanceof Ast.InputParam) {
        if (!questions.some((q) => q === answer.name))
            return null;
    } else {
        assert(questions.length === 1);
        assert(answer instanceof Ast.Value);
        answer = new Ast.InputParam(null, questions[0], answer);
    }

    const currentAction = getActionInvocation(ctx.next);
    if (!isGoodSlotFillQuestion(ctx, questions))
        return null;
    assert(answer instanceof Ast.InputParam);
    if (answer.name === ctx.nextInfo.chainParameter)
        return null;
    const newAction = C.addInvocationInputParam(currentAction, answer);
    if (newAction === null)
        return null;
    return replaceAction(ctx, 'execute', newAction, 'accepted');
}

module.exports = {
    makeSlotFillQuestion,

    preciseSlotFillAnswer,
    impreciseSlotFillAnswer
};
