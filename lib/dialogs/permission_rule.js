// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016-2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const ThingTalk = require('thingtalk');
const Describe = ThingTalk.Describe;

const ValueCategory = require('../semantic').ValueCategory;
const { slotFillProgram } = require('./slot_filling');

module.exports = async function permissionRule(dlg, intent, confident) {
    if (dlg.manager.permissions === null) {
        await dlg.reply("Sorry, this version of Almond does not support adding permissions.");
        return;
    }

    let permissionRule = intent.rule;

    if (dlg.manager.isAnonymous) {
        await dlg.reply(dlg._("Sorry, to allow access to your devices you must log in to your personal account."));
        await dlg.replyLink(dlg._("Register for Almond"), "/user/register");
        return;
    }
    if (!dlg.manager.user.canCreatePermissionRule(permissionRule)) {
        await dlg.forbid();
        return;
    }

    // compute primitive list
    let primitiveList = [];
    if (permissionRule.query.isSpecified)
        primitiveList.push(permissionRule.query);
    if (permissionRule.action.isSpecified)
        primitiveList.push(permissionRule.action);

    function computeIcon() {
        for (let i = primitiveList.length-1; i >= 0; i--) {
            let prim = primitiveList[i];
            if (prim.kind !== 'remote' && !prim.kind.startsWith('__dyn') &&
                prim.kind.indexOf('.') >= 0)
                return prim.kind;
        }
        return null;
    }

    const icon = computeIcon();
    dlg.icon = icon;

    let description = Describe.describePermissionRule(dlg.manager.gettext, permissionRule);
    if (!confident) {
        await dlg.setContext(permissionRule);
        let confirmation = await dlg.ask(ValueCategory.YesNo, dlg._("Okay, so ${permission}. Is that correct?"), {
            permission: description
        });
        if (!confirmation) {
            dlg.reset();
            return;
        }
        dlg.manager.stats.hit('sabrina-confirm');
    }

    let hasSlots = false;
    for (let slot of permissionRule.iterateSlots2()) {
        if (slot instanceof ThingTalk.Ast.Selector || !slot.isUndefined())
            continue;
        let type = slot.type;
        if (!type.isBoolean && !type.isEnum)
            hasSlots = true;
    }

    let ok = await slotFillProgram(dlg, permissionRule);
    if (!ok)
        return;

    description = Describe.describePermissionRule(dlg.manager.gettext, permissionRule);
    dlg.icon = icon;

    if (hasSlots) {
        await dlg.setContext(permissionRule);
        let confirmation = await dlg.ask(ValueCategory.YesNo, dlg._("Okay, so ${permission}. Is that correct?"), {
            permission: description
        });
        if (!confirmation) {
            dlg.reset();
            return;
        }
        dlg.manager.stats.hit('sabrina-confirm');
    }

    let echo = confident && !hasSlots;
    if (echo)
        await dlg.replyInterp(dlg._("Okay, I'm going to remember: ${permission}."), { permission: description });

    // describe the permission rule again to store it in the database
    let metadata;
    [permissionRule, description, metadata] = await dlg.manager.user.adjustPermissionRule(permissionRule, description);

    await dlg.setContext(permissionRule);
    const uniqueId = await dlg.manager.permissions.addPermission(permissionRule, description, metadata);
    await dlg.manager.user.logPermissionRule(uniqueId, permissionRule, description, metadata);

    if (!echo)
        dlg.done();
};
