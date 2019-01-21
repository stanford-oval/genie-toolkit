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

const uuid = require('uuid');

const ThingTalk = require('thingtalk');
const Describe = ThingTalk.Describe;

const ValueCategory = require('../semantic').ValueCategory;
const Helpers = require('../helpers');

const { slotFillProgram } = require('./slot_filling');
const { ensureMessagingConfigured } = require('./messaging');

module.exports = async function setupDialog(dlg, intent) {
    if (dlg.manager.remote === null) {
        dlg.reply("Sorry, this version of Almond does not support asking other users for permission.");
        return;
    }
    if (dlg.manager.isAnonymous) {
        dlg.reply(dlg._("This user is a demo only, and cannot ask other users for permission. To execute this command, you must register an account for yourself."));
        dlg.replyLink(dlg._("Register for Almond"), "/user/register");
        return;
    }

    // check for permission on the incomplete program first
    // this is an incomplete check, but we do it early before
    // asking questions to the user
    if (!await dlg.manager.user.canExecute(intent.program)) {
        dlg.forbid();
        return;
    }

    await ensureMessagingConfigured(dlg);

    let ok = await slotFillProgram(dlg, intent.program);
    if (!ok)
        return;

    let icon = null;
    for (let [, prim] of intent.program.iteratePrimitives()) {
        if (prim.selector.isBuiltin)
            continue;
        let newIcon = Helpers.getIcon(prim);
        if (newIcon)
            icon = newIcon;
    }
    dlg.icon = icon;

    // apply permission rules if needed
    let program = await dlg.manager.user.applyPermissionRules(intent.program);
    if (program === null) {
        dlg.forbid();
        return;
    }

    let name = Describe.getProgramName(dlg.manager.gettext, program);
    let description = Describe.describeProgram(dlg.manager.gettext, program);
    let confirm = await dlg.ask(ValueCategory.YesNo, dlg._("Ok, so you want me to %s. Is that right?")
                    .format(description));
    if (!confirm) {
        dlg.reset();
        return;
    }

    let uniqueId = 'uuid-' + uuid.v4();
    let appMeta = { $icon: icon||null };
    [program, description, appMeta] = await dlg.manager.user.adjustProgram(program, description, appMeta);

    await dlg.manager.user.logProgramExecution(uniqueId, program, description, appMeta);

    const identities = dlg.manager.messaging.getIdentities();
    const identity = Helpers.findPrimaryIdentity(identities);
    const principal = program.principal;
    let ownprograms = program.lowerReturn(dlg.manager.messaging);
    if (ownprograms.length > 0) {
        for (let prog of ownprograms) {
            let code = prog.prettyprint();
            await dlg.manager.apps.loadOneApp(code, appMeta, uniqueId, undefined,
                                              name, description, true);
        }
    }
    program.principal = null;
    dlg.manager.remote.installProgramRemote(principal.value, identity, uniqueId, program).catch((e) => {
        console.log('Ignored error from permission control request: ' + e.code + ': ' + e.message);
    });
    dlg.done();
};
