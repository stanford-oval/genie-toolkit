// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const ThingTalk = require('thingtalk');

function throwCode(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
}

module.exports = class RemoteProgramExecutor {
    constructor(platform, messaging, permissions) {
        this._platform = platform;
        this._messaging = messaging;
        this._permissions = permissions;
    }

    _askForPermission(principal, identity, program) {
        var assistant = this._platform.getCapability('assistant');
        if (!assistant)
            throw throwCode('ENOTSUP', 'Interaction not supported');
        var conversation = assistant.getConversation();
        if (!conversation)
            throw throwCode('EPERM', 'User not available to confirm');

        return conversation.askForPermission(principal, identity, program);
    }

    async _isAllowedProgram(principal, identity, program) {
        const newProgram = await this._permissions.checkIsAllowed(principal, program);
        if (newProgram !== null)
            return newProgram;

        // ask the user for a new policy
        return this._askForPermission(principal, identity, program);
    }

    _cleanProgram(program) {
        for (let [,slot,,] of program.iterateSlots()) {
            if (slot instanceof ThingTalk.Ast.Selector) {
                slot.principal = null;
            } else if (slot.value.isEntity) {
                slot.value.display = null;
            } else if (slot.value.isLocation) {
                if (slot.value.isAbsolute)
                    slot.value.display = null;
                else
                    throwCode('EPERM', 'Relative locations are not allowed');
            }
        }
    }

    async execute(principal, identity, program, uniqueId) {
        if (program.principal !== null)
            throw throwCode('EPERM', 'Permission denied');

        this._cleanProgram(program);
        const newProgram = await this._isAllowedProgram(principal, identity, program);
        if (newProgram === null)
            throw throwCode('EPERM', 'Permission denied');

        var assistant = this._platform.getCapability('assistant');
        if (!assistant)
            throw throwCode('ENOTSUP', 'Interaction not supported');
        var conversation = assistant.getConversation();
        if (!conversation)
            throw throwCode('EPERM', 'User not available to confirm');

        await conversation.runProgram(newProgram, uniqueId, identity);
    }
};
