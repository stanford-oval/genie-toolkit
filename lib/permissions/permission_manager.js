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

const uuid = require('uuid');

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
        return Promise.resolve([]);
    }
}

function getCompatKey(permissionRule) {
    let key = '';
    if (permissionRule.query.isStar)
        key += 'star';
    else if (permissionRule.query.isBuiltin)
        key += 'null';
    else
        key += permissionRule.query.kind + ':' + permissionRule.query.channel;
    key += '+';
    if (permissionRule.action.isStar)
        key += 'star';
    else if (permissionRule.action.isBuiltin)
        key += 'null';
    else
        key += permissionRule.action.kind + ':' + permissionRule.action.channel;
    return key;
}

module.exports = class PermissionManager {
    constructor(platform, messaging, schemaRetriever) {
        this._platform = platform;
        this._messaging = messaging;
        this._db = new PermissionSql(platform);

        this._permissiondb = new Map;
        this._permissionextra = new Map;
        this._checker = new ThingTalk.PermissionChecker(platform.getCapability('smt-solver'),
            schemaRetriever, new GroupDelegate(messaging));
    }

    start() {
        return this._db.getAll().then((rows) => Promise.all(rows.map((row) => {
            return Promise.resolve().then(() => {
                let permissionRule = ThingTalk.Grammar.parsePermissionRule(row.code);
                let extra = JSON.parse(row.extra || '{}');

                this._permissiondb.set(row.uniqueId, permissionRule);
                this._permissionextra.set(row.uniqueId, extra);
                return this._checker.allowed(permissionRule);
            }).catch((e) => {
                console.error('Failed to load permission rule: ' + e);
                return this._db.deleteOne(row.uniqueId);
            });
        })));
    }

    stop() {
        return Promise.resolve();
    }

    getAllPermissions() {
        let ret = [];
        for (let [uniqueId, rule] of this._permissiondb) {
            let extra = this._permissionextra.get(uniqueId) || {};
            ret.push({
                uniqueId: uniqueId,
                rule: rule,
                code: rule.prettyprint(),
                description: extra.$description,
                metadata: extra
            });
        }

        return ret;
    }

    addPermission(permissionRule, description, extra = {}) {
        let uniqueId = uuid.v4();
        let compat_key = getCompatKey(permissionRule);
        let code = permissionRule.prettyprint();
        this._permissiondb.set(uniqueId, permissionRule);
        extra.$description = description;
        this._permissionextra.set(uniqueId, extra);

        return this._checker.allowed(permissionRule).then(() => {
            return this._db.insertOne(uniqueId,
                { code, compat_key, extra: JSON.stringify(extra) });
        });
    }

    removePermission(uniqueId) {
        let permissionRule = this._permissiondb.get(uniqueId);
        this._permissiondb.delete(uniqueId);
        this._permissionextra.delete(uniqueId);
        this._checker.disallowed(permissionRule);

        return this._db.deleteOne(uniqueId);
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
            return Promise.reject(throwCode('EINVAL', 'Invalid identity'));
        if (!identity.startsWith('phone:') && !identity.startsWith('email:') && !identity.startsWith('omlet:') && !identity.startsWith('matrix-account:'))
            return Promise.reject(throwCode('EINVAL', 'Invalid identity ' + identity));
        return this._messaging.getAccountForIdentity(identity).then((account) => {
            if (!account)
                throw throwCode('EINVAL', 'Invalid identity ' + identity);
            if (this._messaging.type + '-account:' + account !== principal)
                throw throwCode('EPERM', 'Identity does not match principal');
        });
    }

    checkCanBeAllowed(principal, program) {
        return this._checker.check(ThingTalk.Ast.Value.Entity(principal, 'tt:contact', null), program,
                                   { transform: false });
    }

    checkIsAllowed(principal, program) {
        return this._checker.check(ThingTalk.Ast.Value.Entity(principal, 'tt:contact', null), program,
                                   { transform: true });
    }

    _isAllowedProgram(principal, identity, program) {
        return this._verifyIdentity(principal, identity).then(() => {
            return this.checkIsAllowed(principal, program);
        }).then((newProgram) => {
            if (newProgram !== null) {
                return newProgram;
            } else {
                // ask the user for a new policy
                return this._askForPermission(principal, identity, program);
            }
        });
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

    installProgram(principal, identity, program, uniqueId) {
        if (program.principal !== null)
            return Promise.reject(throwCode('EPERM', 'Permission denied'));
        return Promise.resolve().then(() => {
            this._cleanProgram(program);
            return this._isAllowedProgram(principal, identity, program);
        }).then((newProgram) => {
            if (newProgram === null)
                throw throwCode('EPERM', 'Permission denied');

            var assistant = this._platform.getCapability('assistant');
            if (!assistant)
                throw throwCode('ENOTSUP', 'Interaction not supported');
            var conversation = assistant.getConversation();
            if (!conversation)
                throw throwCode('EPERM', 'User not available to confirm');

            return conversation.runProgram(newProgram, uniqueId, identity);
        }).then(() => undefined);
    }
};
