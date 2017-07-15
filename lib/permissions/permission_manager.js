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

function throwCode(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
}

module.exports = class PermissionManager {
    constructor(platform, messaging) {
        this._platform = platform;
        this._messaging = messaging;

        this._nextId = 0;
        this._interactiveRequests = {};
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

    _verifyIdentity(principal, identity) {
        if (!identity)
            return Q();
        if (!identity.startsWith('phone:') && !identity.startsWith('email:') && !identity.startsWith('omlet:'))
            return Q.reject(throwCode('EINVAL', 'Invalid identity ' + identity));
        return this._messaging.getAccountForIdentity(identity).then((account) => {
            if (!account)
                throw throwCode('EINVAL', 'Invalid identity ' + identity);
            if (this._messaging.type + '-account:' + account !== principal)
                throw throwCode('EPERM', 'Identity does not match principal');
        });
    }

    isAllowedProgram(principal, identity, program) {
        // always ask the user
        return this._verifyIdentity(principal, identity).then(() => {
            return this._askForPermission(principal, identity, rule);
        });
    }
}
