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
const Type = ThingTalk.Type;

const C = require('../ast_manip');

const {
    getActionInvocation,
    makeAgentReply,
    makeSimpleState,
    sortByName,
} = require('../state_manip');


function makeActionConfirmationPhrase(ctx, action) {
    const ctxInvocation = getActionInvocation(ctx.next);
    if (ctxInvocation.selector.isBuiltin)
        return null;
    if (!C.isSameFunction(ctxInvocation.schema, action.schema))
        return null;

    // all parameters have been slot-filled, otherwise we wouldn't be confirming...
    assert(ctxInvocation.in_params.every((ip) => !ip.value.isUndefined));
    if (action.in_params.length !== ctxInvocation.in_params.length)
        return null;

    ctxInvocation.in_params.sort(sortByName);
    action.in_params.sort(sortByName);

    for (let i = 0; i < action.in_params.length; i++) {
        if (action.in_params[i].name !== ctxInvocation.in_params[i].name)
            return null;

        if (!action.in_params[i].value.equals(ctxInvocation.in_params[i].value))
            return null;
    }

    return makeAgentReply(ctx, makeSimpleState(ctx, 'sys_confirm_action', null), null, Type.Boolean);
}

module.exports = {
    makeActionConfirmationPhrase
};
