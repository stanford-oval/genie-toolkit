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
const Type = ThingTalk.Type;
const Describe = ThingTalk.Describe;

const ValueCategory = require('../semantic').ValueCategory;
const Helpers = require('../helpers');

const { slotFillProgram } = require('./slot_filling');
const { contactSearch } = require('./contact_search');
const { ensureMessagingConfigured } = require('./messaging');

module.exports = async function setupDialog(dlg, intent) {
    await ensureMessagingConfigured(dlg);

    let program = intent.program;

    let person = program.principal;
    if (person.type === 'tt:username')
        person = await contactSearch(dlg, Type.Entity('tt:contact'), person.value);
    program.principal = person;

    let ok = await slotFillProgram(dlg, program);
    if (!ok)
        return { ok };

    let icon = null;
    for (let [, prim] of program.iteratePrimitives()) {
        if (prim.selector.isBuiltin)
            continue;
        let newIcon = Helpers.getIcon(prim);
        if (newIcon)
            icon = newIcon;
    }
    dlg.icon = icon;

    let name = Describe.getProgramName(dlg.manager.gettext, program);
    let description = Describe.describeProgram(dlg.manager.gettext, program);
    let confirm = await dlg.ask(ValueCategory.YesNo, dlg._("Ok, so you want me to %s. Is that right?")
                    .format(description));
    if (!confirm)
        return dlg.reset();

    const identities = dlg.manager.messaging.getIdentities();
    const identity = Helpers.findPrimaryIdentity(identities);
    const uniqueId = 'uuid-' + uuid.v4();
    const principal = program.principal;
    let ownprograms = program.lowerReturn(dlg.manager.messaging);
    if (ownprograms.length > 0) {
        for (let prog of ownprograms) {
            let code = prog.prettyprint();
            await dlg.manager.apps.loadOneApp(code, { $icon: icon }, uniqueId, undefined,
                                              name, description, true);
        }
    }
    program.principal = null;
    dlg.manager.remote.installProgramRemote(principal.value, identity, uniqueId, program).catch((e) => {
        console.log('Ignored error from permission control request: ' + e.code + ': ' + e.message);
    });
    return dlg.done();
};