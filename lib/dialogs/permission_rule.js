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
        dlg.reply("Sorry, this version of Almond does not support adding permissions.");
        return;
    }

    let permissionRule = intent.rule;

    if (dlg.manager.isAnonymous) {
        dlg.reply(dlg._("This user is a demo only; you cannot change the permissions on it."));
        return;
    }
    if (!dlg.manager.user.canCreatePermissionRule(permissionRule)) {
        dlg.forbid();
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
        let confirmation = await dlg.ask(ValueCategory.YesNo, dlg._("Ok, so %s. Is that right?").format(description));
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
        let confirmation = await dlg.ask(ValueCategory.YesNo, dlg._("Ok, so %s. Is that right?").format(description));
        if (!confirmation) {
            dlg.reset();
            return;
        }
        dlg.manager.stats.hit('sabrina-confirm');
    }

    let echo = confident && !hasSlots;
    if (echo)
        dlg.reply(dlg._("Ok, I'm going to set: %s.").format(description));

    // describe the permission rule again to store it in the database
    let metadata;
    [permissionRule, description, metadata] = await dlg.manager.user.adjustPermissionRule(permissionRule, description);

    const uniqueId = await dlg.manager.permissions.addPermission(permissionRule, description, metadata);
    await dlg.manager.user.logPermissionRule(uniqueId, permissionRule, description, metadata);

    if (!echo)
        dlg.done();
};
