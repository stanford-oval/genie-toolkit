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

const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Generate = ThingTalk.Generate;
const Describe = ThingTalk.Describe;

const ValueCategory = require('../semantic').ValueCategory;
const Helpers = require('../helpers');

const { slotFillProgram } = require('./slot_filling');
const askAnything = require('./ask_anything');
const { showNotification, showError } = require('./notifications');

function isSafeAction({ selector, channel }) {
    if (selector.principal !== null)
        return false;
    if (selector.kind === 'org.thingpedia.builtin.thingengine.builtin')
        return true;
    if (selector.kind === 'org.thingpedia.builtin.thingengine.home')
        return true;
    if (selector.kind === 'org.thingpedia.builtin.thingengine.phone' &&
        channel === 'set_ringer')
        return true;
    return false;
}

function* completeProgram(dlg, program, skipConfirmation) {
    let hasTrigger = program.rules.length > 0 && program.rules.some((r) => r.isRule);
    let primitiveQuery = undefined;
    let primitiveAction = undefined;

    for (let [primType, prim] of Generate.iteratePrimitives(program)) {
        if (prim.selector.isBuiltin)
            continue;
        if (primType === 'table') {
            if (primitiveQuery === undefined)
                primitiveQuery = prim;
            else
                primitiveQuery = null;
        } else if (primType === 'action') {
            if (primitiveAction === undefined)
                primitiveAction = prim;
            else
                primitiveAction = null;
        }
    }
    if (dlg.manager.isAnonymous) {
        if (hasTrigger) {
            dlg.reply(dlg._("This user is a demo only, and cannot enable long-running commands. To execute this command, you must register an account for yourself."));
            dlg.replyLink(dlg._("Register for Almond"), "/user/register");
            return { ok: false };
        }
        if (!primitiveQuery && (!primitiveAction || !isSafeAction(primitiveAction))) {
            dlg.reply(dlg._("This user is a demo only, and cannot perform actions. To execute this command, you must register an account for yourself."));
            dlg.replyLink(dlg._("Register for Almond"), "/user/register");
            return { ok: false };
        }
    }

    let ok = yield* slotFillProgram(dlg, program);
    if (!ok)
        return { ok };

    let icon = null;
    for (let [, prim] of Generate.iteratePrimitives(program)) {
        if (prim.selector.isBuiltin)
            continue;
        let newIcon = Helpers.getIcon(prim);
        if (newIcon)
            icon = newIcon;
    }

    let autoConfirm;
    if (!skipConfirmation) {
        if (hasTrigger)
            autoConfirm = false;
        else if (primitiveAction && isSafeAction(primitiveAction))
            autoConfirm = true;
        else if (primitiveQuery && primitiveAction === undefined && primitiveQuery.selector.principal === null)
            autoConfirm = true;
        else
            autoConfirm = false;
    } else {
        autoConfirm = true;
    }

    return { ok: true, autoConfirm, hasTrigger, icon };
}

const FACTORING_IMPLEMENTED = false;

module.exports = function* ruleDialog(dlg, intent, skipConfirmation, uniqueId) {
    let program;
    if (intent.isProgram)
        program = intent.program;
    else
        program = Generate.primitiveProgram(intent.primitiveType, intent.primitive);
    assert(program.isProgram);
    dlg.debug('About to execute program', Ast.prettyprint(program));

    dlg.icon = null;
    let { ok, autoConfirm, hasTrigger, icon } = yield* completeProgram(dlg, program, skipConfirmation);
    if (!ok)
        return;

    let name = Describe.getProgramName(dlg.manager.gettext, program);
    let description = Describe.describeProgram(dlg.manager.gettext, program);

    let appMeta = { $icon: icon||null };
    if (!hasTrigger)
        appMeta.$conversation = dlg.manager.id;
    if (!autoConfirm) {
        let confirmation = yield dlg.ask(ValueCategory.YesNo, dlg._("Ok, so you want me to %s. Is that right?").format(description));
        if (!confirmation) {
            dlg.reset();
            return;
        }

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
