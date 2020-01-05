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
    constructor(platform, groupDelegate, schemaRetriever) {
        this._platform = platform;
        this._db = new PermissionSql(platform);
        this._schemas = schemaRetriever;

        this._permissiondb = new Map;
        this._permissionextra = new Map;
        this._checker = new ThingTalk.PermissionChecker(platform.getCapability('smt-solver'),
            schemaRetriever, groupDelegate);
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
                code: rule.prettyprint(),
                description: extra.$description,
                metadata: extra
            });
        }

        return ret;
    }

    getPermission(uniqueId) {
        const permissionRule = this._permissiondb.get(uniqueId);
        if (!permissionRule)
            return undefined;
        const extra = this._permissionextra.get(uniqueId) || {};
        return {
            uniqueId: uniqueId,
            code: permissionRule.prettyprint(),
            description: extra.$description,
            metadata: extra
        };
    }

    async addPermission(permissionRule, description, extra = {}) {
        if (typeof permissionRule === 'string') {
            permissionRule = await ThingTalk.Grammar.parseAndTypecheck(permissionRule, this._schemas, true);
            description = ThingTalk.Describe.describePermissionRule(this._platform.getCapability('gettext'), permissionRule);
        }

        let uniqueId = uuid.v4();
        let compat_key = getCompatKey(permissionRule);
        let code = permissionRule.prettyprint();
        this._permissiondb.set(uniqueId, permissionRule);
        extra.$description = description;
        this._permissionextra.set(uniqueId, extra);

        await this._checker.allowed(permissionRule);
        await this._db.insertOne(uniqueId, {
            code, compat_key,
            extra: JSON.stringify(extra)
        });
        return uniqueId;
    }

    removePermission(uniqueId) {
        let permissionRule = this._permissiondb.get(uniqueId);
        this._permissiondb.delete(uniqueId);
        this._permissionextra.delete(uniqueId);
        this._checker.disallowed(permissionRule);

        return this._db.deleteOne(uniqueId);
    }

    checkCanBeAllowed(principal, program) {
        return this._checker.check(new ThingTalk.Ast.Value.Entity(principal, 'tt:contact', null), program,
                                   { transform: false });
    }

    checkIsAllowed(principal, program) {
        return this._checker.check(new ThingTalk.Ast.Value.Entity(principal, 'tt:contact', null), program,
                                   { transform: true });
    }
};
module.exports.prototype.$rpcMethods = ['getAllPermissions', 'getPermission', 'addPermission', 'removePermission'];
