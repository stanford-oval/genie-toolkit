// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016-2017 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const assert = require('assert');
const uuid = require('uuid');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;
const Generate = ThingTalk.Generate;
const Describe = ThingTalk.Describe;

const ValueCategory = require('../semantic').ValueCategory;
const Helpers = require('../helpers');

const contactSearch = require('./contact_search');

module.exports = function* setupDialog(dlg) {
    let intent = yield dlg.nextIntent();

    let person = intent.person;
    if (person.type === 'tt:contact_name')
        person = yield* contactSearch(dlg, Type.Entity('tt:contact'), person.value);

    let confirm = yield dlg.ask(ValueCategory.YesNo, dlg._("Ok, so you want me to tell %s: %s. Is that right?")
                    .format(Describe.describeArg(dlg.manager.gettext, person),
                            Describe.describeProgram(dlg.manager.gettext, intent.program)));
    if (!confirm)
        return dlg.reset();

    const identities = dlg.manager.messaging.getIdentities();
    const identity = Helpers.findPrimaryIdentity(identities);
    const uniqueId = 'uuid-' + uuid.v4();
    dlg.manager.remote.installProgramRemote(principal, identity, uniqueId, intent.program).catch((e) => {
        console.log('Ignored error from permission control request: ' + e.code + ': ' + e.message);
    });
    return dlg.done();
}
