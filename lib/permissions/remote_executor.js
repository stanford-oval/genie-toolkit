// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const ThingTalk = require('thingtalk');

const Config = require('../config');

const ChannelOpener = require('../apps/channel_opener');
const ExecEnvironment = ThingTalk.ExecEnvironment;

function throwCode(code, message) {
    var e = new Error(message);
    e.code = code;
    throw e;
}

module.exports = class RemoteExecutor {
    constructor(engine, permissions) {
        this._engine = engine;
        this._permissions = permissions;
    }

    installProgram(principal, identity, program) {
        return this._permissions.isAllowedProgram(principal, identity, program).then((allowed) => {
            if (!allowed)
                throwCode('EPERM', 'Permission denied');

            var assistant = this._engine.platform.getCapability('assistant');
            if (!assistant)
                throwCode('ENOTSUP', 'Interaction not supported');
            var conversation = assistant.getConversation();
            if (!conversation)
                throwCode('EPERM', 'User not available to confirm');

            return conversation.runProgram(program);
        }).then(() => undefined);
    }
}
