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
const PermissionSql = require('../db/permissions');

function throwCode(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
}

class GroupDelegate {
    constructor(messaging) {
        this._messaging = messaging;
    }

    getGroups(principal) {
        // FINISHME
        return Q([]);
    }
}

module.exports = class PermissionManager {
    constructor(platform, messaging, schemaRetriever) {
        this._platform = platform;
        this._messaging = messaging;
        this._db = new PermissionSql(platform);
        this._checker = new ThingTalk.PermissionChecker(platform.getCapability('smt-solver'),
            schemaRetriever, new GroupDelegate(messaging));
    }

    start() {
        return this._db.getAll().then((rows) =>
            Q.all(rows.map((row) =>
                this._checker.allowed(ThingTalk.Grammar.parsePermissionRule(row.code)))));
    }

    stop() {
        return Q();
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
            return Q.reject(throwCode('EINVAL', 'Invalid identity'));
        if (!identity.startsWith('phone:') && !identity.startsWith('email:') && !identity.startsWith('omlet:'))
            return Q.reject(throwCode('EINVAL', 'Invalid identity ' + identity));
        return this._messaging.getAccountForIdentity(identity).then((account) => {
            if (!account)
                throw throwCode('EINVAL', 'Invalid identity ' + identity);
            if (this._messaging.type + '-account:' + account !== principal)
                throw throwCode('EPERM', 'Identity does not match principal');
        });
    }

    _tryAutoAllowed(principal, program) {
        return this._checker.check(principal, program);
    }

    _isAllowedProgram(principal, identity, program) {
        return this._verifyIdentity(principal, identity).then(() => {
            return this._tryAutoAllowed(principal, program);
        }).then((newProgram) => {
            if (newProgram !== null) {
                return newProgram;
            } else {
                // ask the user for a new policy
                return this._askForPermission(principal, identity, program).then((allowed) =>
                    allowed ? program : null);
            }
        });
    }

    installProgram(principal, identity, program) {
        return this._isAllowedProgram(principal, identity, program).then((newProgram) => {
            if (newProgram === null)
                throw throwCode('EPERM', 'Permission denied');

            var assistant = this._platform.getCapability('assistant');
            if (!assistant)
                throw throwCode('ENOTSUP', 'Interaction not supported');
            var conversation = assistant.getConversation();
            if (!conversation)
                throw throwCode('EPERM', 'User not available to confirm');

            return conversation.runProgram(newProgram);
        }).then(() => undefined);
    }
}
