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

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;
const Generate = ThingTalk.Generate;
const Describe = ThingTalk.Describe;

const ValueCategory = require('../semantic').ValueCategory;
const Helpers = require('../helpers');

const deviceChoice = require('./device_choice');
const { slotFillPrimitive } = require('./slot_filling');

module.exports = function* ruleDialog(dlg, intent) {
    let program;
    if (intent.isProgram) {
        program = intent.program;
    } else {
        program = Generate.primitiveProgram(intent.primitiveType, intent.primitive);
    }
    assert(program.isProgram);
    //console.log(Ast.prettyprint(program));

    // compute primitive list
    let primitiveList = [];
    let hasTrigger = false;
    program.rules.forEach((r) => {
        if (r.trigger) {
            hasTrigger = true;
            primitiveList.push(r.trigger);
        }
        primitiveList = primitiveList.concat(r.queries);
        primitiveList = primitiveList.concat(r.actions.filter((a) => !a.selector.isBuiltin));
    });

    let primitiveQuery = null;
    if (primitiveList.length === 1 &&
        program.rules.length === 1 &&
        program.rules[0].queries.length === 1) {
        primitiveQuery = program.rules[0].queries[0];
    }
    let primitiveAction = null;
    if (primitiveList.length === 1 &&
        program.rules.length === 1 &&
        program.rules[0].queries.length === 0 &&
        !program.rules[0].trigger &&
        program.rules[0].actions.length === 1) {
        primitiveAction = program.rules[0].actions[0];
    }

    function computeIcon() {
        for (let i = primitiveList.length-1; i >= 0; i--) {
            let prim = primitiveList[i];
            if (prim.selector.kind !== 'remote' &&
                !prim.selector.kind.startsWith('__dyn')
                && prim.selector.device)
                return prim.selector.device.kind;
        }
        return null;
    }

    dlg.icon = computeIcon();
    for (let prim of primitiveList) {
        let ok = yield* chooseDevice(dlg, prim.selector);
        if (!ok)
            return;
        dlg.icon = computeIcon();
    }
    let scope = {};
    for (let prim of primitiveList) {
        let ok = yield* slotFillPrimitive(dlg, prim, scope);
        if (!ok)
            return;
        dlg.icon = computeIcon();
    }

    let name = Describe.getProgramName(dlg.manager.gettext, program);
    let description = Describe.describeProgram(dlg.manager.gettext, program);

    let autoConfirm;
    if (hasTrigger)
        autoConfirm = false;
    else if (primitiveAction && primitiveAction.selector.kind === 'builtin' && primitiveAction.selector.principal === null)
        autoConfirm = true;
    else if (primitiveQuery && primitiveQuery.selector.principal === null)
        autoConfirm = true;
    else
        autoConfirm = false;

    let confirmation;
    if (autoConfirm)
        confirmation = true;
    else
        confirmation = yield dlg.ask(ValueCategory.YesNo, dlg._("Ok, so you want me to %s. Is that right?").format(description));
    if (!confirmation)
        return dlg.reset();

    dlg.manager.stats.hit('sabrina-confirm');
    let appMeta = { $icon: dlg.icon };
    if (!hasTrigger)
        appMeta.$conversation = dlg.manager.id;

    let [newprogram, sendprograms] = ThingTalk.Generate.factorProgram(dlg.manager.messaging, program);

    let app = null;
    if (newprogram !== null) {
        let code = Ast.prettyprint(newprogram);
        app = yield dlg.manager.apps.loadOneApp(code, appMeta, undefined, undefined,
                                                name, description, true);
    }
    yield Helpers.sendRules(dlg, sendprograms, app);

    if (!autoConfirm)
        dlg.done();
}
