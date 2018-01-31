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
const askAnything = require('./ask_anything');
const { showNotification, showError } = require('./notifications');

function* completeProgram(dlg, program, skipConfirmation) {
    let hasTrigger = program.rules.length > 0;
    let primitiveQuery = null;
    if (program.rules.length === 1 &&
        program.rules[0].isCommand &&
        program.rules[0].table !== null &&
        program.rules[0].table.isInvocation &&
        program.rules[0].actions.length === 1 &&
        program.rules[0].actions[0].selector.isBuiltin)
        primitiveQuery = program.rules[0].table.invocation;
    let primitiveAction = null;
    if (program.rules.length === 1 &&
        program.rules[0].isCommand &&
        program.rules[0].table === null &&
        program.rules[0].actions.length === 1)
        primitiveAction = program.rules[0].actions[0];

    let scope = {};
    for (let prim of Generate.iteratePrimitives(program)) {
        if (prim.selector.isBuiltin)
            continue;

        let ok = yield* deviceChoice(dlg, prim.selector);
        if (!ok)
            return { ok };
        if (prim.selector.kind !== 'remote' &&
            !prim.selector.kind.startsWith('__dyn')
            && prim.selector.device)
            dlg.icon = prim.selector.device.kind;
        ok = yield* slotFillPrimitive(dlg, prim, scope);
        if (!ok)
            return { ok };
    }

    let autoConfirm;
    if (!skipConfirmation) {
        if (hasTrigger)
            autoConfirm = false;
        else if (primitiveAction && primitiveAction.selector.kind === 'org.thingpedia.builtin.thingengine.builtin' && primitiveAction.selector.principal === null)
            autoConfirm = true;
        else if (primitiveQuery && primitiveQuery.selector.principal === null)
            autoConfirm = true;
        else
            autoConfirm = false;
    } else {
        autoConfirm = true;
    }

    return { ok: true, autoConfirm, hasTrigger };
}

const DESCRIBE_IMPLEMENTED = false;
const FACTORING_IMPLEMENTED = false;

module.exports = function* ruleDialog(dlg, intent, skipConfirmation, uniqueId) {
    let program;
    if (intent.isProgram)
        program = intent.program;
    else
        program = Generate.primitiveProgram(intent.primitiveType, intent.primitive);
    assert(program.isProgram);

    dlg.icon = null;
    let { ok, autoConfirm, hasTrigger } = yield* completeProgram(dlg, program, skipConfirmation);
    if (!ok)
        return;

    let name = "some program", description = "do something";
    if (DESCRIBE_IMPLEMENTED) {
        name = Describe.getProgramName(dlg.manager.gettext, program);
        description = Describe.describeProgram(dlg.manager.gettext, program);
    }

    let appMeta = { $icon: dlg.icon };
    if (!hasTrigger)
        appMeta.$conversation = dlg.manager.id;
    if (!autoConfirm) {
        let confirmation = yield dlg.ask(ValueCategory.YesNo, dlg._("Ok, so you want me to %s. Is that right?").format(description));
        if (!confirmation)
            return dlg.reset();

        dlg.manager.stats.hit('sabrina-confirm');
    }

    if (skipConfirmation)
        dlg.reply(dlg._("Ok, I'm going to %s").format(description));
    let newprogram, sendprograms;
    if (FACTORING_IMPLEMENTED) {
        [newprogram, sendprograms] = ThingTalk.Generate.factorProgram(dlg.manager.messaging, program);
    } else {
        newprogram = program;
        sendprograms = [];
    }

    let app = null;
    if (newprogram !== null) {
        let code = Ast.prettyprint(newprogram);
        app = yield dlg.manager.apps.loadOneApp(code, appMeta, uniqueId, undefined,
                                                name, description, true);
    }
    yield Helpers.sendRules(dlg, sendprograms, app);

    if (app) {
        // drain the queue of results from the app
        while (true) {
            let { item: next, resolve, reject } = yield app.mainOutput.next();

            try {
                if (next.isDone) {
                    resolve();
                    break;
                }

                let value;
                if (next.isNotification)
                    value = yield* showNotification(dlg, undefined, next.icon, next.outputType, next.outputValue, next.currentChannel, undefined);
                else if (next.isError)
                    value = yield* showError(dlg, undefined, next.icon, next.error, undefined);
                else if (next.isQuestion)
                    value = yield* askAnything(dlg, undefined, next.icon, next.type, next.question);
                resolve(value);
            } catch(e) {
                reject(e);
            }
        }
    }

    if (!autoConfirm)
        dlg.done();
};
