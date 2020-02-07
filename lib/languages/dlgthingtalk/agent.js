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

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

/**
 * Run the dialogue, executing ThingTalk and invoking the policy at the
 * right time.
 *
 * This is used both during simulation (when generating a dataset) and for
 * the real thing.
 */
class DialogueAgent {
    constructor(executor, options) {
        this._rng = options.rng;
        this._executor = executor;
    }

    _isExecutable(stmt, confirm) {
        let hasUndefined = false;
        let needsConfirm = false;
        if (stmt.isRule)
            needsConfirm = true;
        if (needsConfirm && !confirm)
            return false;
        const visitor = new class extends Ast.NodeVisitor {
            visitValue(value) {
                if (value.isUndefined)
                    hasUndefined = true;
                return true;
            }

            visitInvocation(value) {
                if (value.schema.annotations.confirm)
                    needsConfirm = needsConfirm || value.schema.annotations.confirm.toJS();
                else
                    needsConfirm = needsConfirm || value.schema.functionType === 'action';
                return false;
            }
        };
        stmt.visit(visitor);

        if (hasUndefined)
            return false;
        if (needsConfirm && !confirm)
            return false;

        return true;
    }

    /**
     * Execute the query or action implied by the current dialogue state.
     *
     * This method should return a new dialogue state with filled information
     * about the result. It should not modify the state in-place.
     *
     * @param {any} state - the current state, representing the query or action to execute
     * @return {ant} - the new state, with information about the returned query or action
     */
    async execute(state) {
        let anyChange = false;
        let clone = state;
        for (let i = 0; i < clone.history.length; i++) {
            if (clone.history[i].results !== null)
                continue;
            if (!this._isExecutable(clone.history[i].stmt, clone.history[i].confirm))
                continue;

            if (!anyChange) {
                clone = state.clone();
                anyChange = true;
            }

            clone.history[i].results = await this._executor.executeStatement(clone.history[i].stmt);
        }

        return clone;
    }
}
module.exports = DialogueAgent;
