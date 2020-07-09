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
} = require('../state_manip');

function contextualAction(ctx, action) {
    assert(action instanceof Ast.Invocation);
    const ctxInvocation = getActionInvocation(ctx.next);
    if (ctxInvocation.selector.isBuiltin)
        return null;
    if (!C.isSameFunction(ctxInvocation.schema, action.schema))
        return null;
    if (action.in_params.length === 0) // common case, no new parameters
        return ctxInvocation;

    const clone = ctxInvocation.clone();
    for (let newParam of action.in_params) {
        if (newParam.value.isUndefined)
            continue;

        // check that we don't change a previous parameter

        // if we're introducing a value for the chain parameter that was not previously provided,
        // it must one of the top 3 results
        if (newParam.name === ctx.nextInfo.chainParameter &&
           !ctx.nextInfo.chainParameterFilled) {
            if (!ctx.results)
                return null;
            const results = ctx.results;
            let good = false;
            for (let i = 0; i < Math.min(results.length, 3); i ++) {
                const id = results[i].value.id;
                if (id && id.equals(newParam.value)) {
                    good = true;
                    break;
                }
            }
            if (!good)
                return null;
        }

        let found = false;
        for (let oldParam of clone.in_params) {
            if (newParam.name === oldParam.name) {
                if (oldParam.value.isUndefined)
                    oldParam.value = newParam.value;
                else if (!newParam.value.equals(oldParam.value))
                    return null;
                found = true;
                break;
            }
        }
        if (!found)
            clone.in_params.push(newParam);
    }

    return clone;
}

module.exports = {
    contextualAction
};
