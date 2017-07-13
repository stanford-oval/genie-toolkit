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

    execute(principal, device, channelType, channel, args) {
        var check;
        switch (channelType) {
        case 'format-query':
            check = this._permissions.isAllowedFormatQuery(principal, device, channel, args);
            break;
        case 'format-trigger':
            check = this._permissions.isAllowedFormatTrigger(principal, device, channel, args);
            break;
        default:
            check = Q(false);
        }

        return check.then((allowed) => {
            if (!allowed)
                throwCode('EPERM', 'Permission denied');

            switch (channelType) {
            case 'format-query':
                return this._executeFormatQuery(principal, device, channel, args);
            case 'format-trigger':
                return this._executeFormatTrigger(principal, device, channel, args);
            }
        });
    }

    _executeFormatQuery(principal, device, channel, args) {
        var opener = new ChannelOpener(this._engine, null, 'q', device, channel);
        var env = new ExecEnvironment({}, this._engine.platform.locale, this._engine.platform.timezone);

        return opener.start().then(() => {
            var first = opener.values()[0] || null;
            env.currentChannel = first;
            env.queryInput = [];
            env.queryValue = args;
            return env.formatEvent('messages');
        }).finally(() => opener.stop());
    }

    _executeFormatTrigger(principal, device, channel, args) {
        var opener = new ChannelOpener(this._engine, null, 'r', device, channel);
        var env = new ExecEnvironment({}, this._engine.platform.locale, this._engine.platform.timezone);

        return opener.start().then(() => {
            var first = opener.values()[0] || null;
            env.currentChannel = first;
            env.triggerValue = args;
            return env.formatEvent('messages');
        }).finally(() => opener.stop());
    }
}
