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

module.exports = async function permissionRule(dlg, intent) {
    if (dlg.manager.permissions === null) {
        dlg.reply("Sorry, this version of Almond does not support adding permissions.");
        return;
    }

    const permissionRule = intent.rule;

    if (!dlg.manager.user.isOwner) {
        dlg.reply(dlg._("I'm sorry, only my owner can change my permissions."));
        return;
    }
    if (dlg.manager.isAnonymous) {
        dlg.reply(dlg._("This user is a demo only; you cannot change the permissions on it."));
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

    let ok = await slotFillProgram(dlg, permissionRule);
    if (!ok)
        return;

    dlg.icon = computeIcon();

    let description = Describe.describePermissionRule(dlg.manager.gettext, permissionRule);

    let confirmation = await dlg.ask(ValueCategory.YesNo, dlg._("Ok, so %s. Is that right?").format(description));
    if (!confirmation) {
        dlg.reset();
        return;
    }

    dlg.manager.stats.hit('sabrina-confirm');
    await dlg.manager.permissions.addPermission(permissionRule, description);
    dlg.done();
};
