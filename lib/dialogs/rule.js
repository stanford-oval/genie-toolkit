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
const uuid = require('uuid');

const ThingTalk = require('thingtalk');
const Describe = ThingTalk.Describe;

const ValueCategory = require('../semantic').ValueCategory;
const Helpers = require('../helpers');

const { slotFillProgram } = require('./slot_filling');
const askAnything = require('./ask_anything');
const { showNotification, showError } = require('./notifications');

function getIdentityName(dlg, identity) {
    var split = identity.split(':');

    if (split[0] === 'omlet')
        return dlg._("Omlet User @%s").format(split[1]);

    let contactApi = dlg.manager.platform.getCapability('contacts');
    if (contactApi !== null) {
        return contactApi.lookupPrincipal(identity).then((contact) => {
            if (contact)
                return contact.displayName;
            else
                return split[1];
        });
    } else {
        return split[1];
    }
}

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
    if (selector.kind === 'org.thingpedia.builtin.thingengine.gnome' &&
        channel === 'open_app')
        return true;

    if (selector.kind === 'com.spotify') return true;
    return false;
}

async function prepareProgram(dlg, program, source) {
    let hasTrigger = program.rules.length > 0 && program.rules.some((r) => r.isRule);
    let primitiveQuery = undefined;
    let primitiveAction = undefined;
    let hasResult = false;
    let primCount = 0;
    dlg.icon = null;

    for (let [primType, prim] of program.iteratePrimitives()) {
        if (prim.selector.isBuiltin) {
            if (prim.channel === 'notify' && !hasTrigger)
                hasResult = true;
            continue;
        }
        primCount += 1;
        if (primType === 'query') {
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

    let icon;
    for (let [, prim] of program.iteratePrimitives()) {
        if (prim.selector.isBuiltin)
            continue;
        let newIcon = Helpers.getIcon(prim);
        if (newIcon)
            icon = newIcon;
    }
    dlg.icon = icon;

    let hasSlots = false;
    for (let [schema, slot] of program.iterateSlots()) {
        if (slot instanceof ThingTalk.Ast.InputParam && slot.value.isUndefined) {
            hasSlots = true;
            let type = schema.getArgType(slot.name);
            if (!type.isBoolean && !type.isEnum)
                hasSlots = true;
        }
    }

    let programType = 'general';
    if (!source && !hasTrigger && primCount === 1) {
        if (primitiveAction && isSafeAction(primitiveAction))
            programType = 'safeAction';
        if (primitiveQuery)
            programType = 'query';
    }

    return { ok: true, programType, hasTrigger, hasSlots, hasResult, icon };
}

async function drain(output) {
    for (;;) {
        let { item, resolve } = await output.next();
        resolve();
        if (item.isDone)
            return;
    }
}

const PAGE_SIZE = 5;

async function displayResult(dlg, app, { hasResult, echo }) {
    let anyResult = false;

    let count = 0;
    for (;;) {
        let { item: next, resolve, reject } = await app.mainOutput.next();
        if (next.isQuestion) {
            try {
                const value = await askAnything(dlg, undefined, next.icon, next.type, next.question);
                resolve(value);
            } catch(e) {
                reject(e);
            }
            continue;
        }

        // resolve immediately so that the program can continue and
        // push the next result in the `app.mainOutput` queue
        resolve();
        if (next.isDone)
            break;

        anyResult = true;
        if (count >= PAGE_SIZE) {
            // ask the user before displaying further results
            dlg.replySpecial(dlg._("Show more result…"), 'more');
            try {
                await dlg.askMoreResults();
                count = 0;
            } catch(e) {
                if (e.code === 'ECANCELLED') {
                    // drain the output so that the app finishes running, otherwise
                    // we might leave it unfinished and have to rely on GC to release its
                    // resources
                    await drain(app.mainOutput);
                    break;
                }

                // any other error we don't expect, so throw it to report
                // an error message to the user and log the stack
                throw e;
            }
        }
        count++;

        if (next.isNotification)
            await showNotification(dlg, undefined, next.icon, next.outputType, next.outputValue, next.currentChannel, undefined);
        else if (next.isError)
            await showError(dlg, undefined, next.icon, next.error, undefined);
    }
    if (!anyResult) {
        if (hasResult)
            dlg.reply(dlg._("Sorry, I did not find any result for that."));
        // if we didn't echo before execution, say "Consider it done"
        else if (!echo)
            dlg.done();
    }
}

function confirm(dlg, description, source) {
    if (source)
        return dlg.ask(ValueCategory.YesNo, dlg._("Ok, so you want me to %s (as asked by %s). Is that right?").format(description, source));
    else
        return dlg.ask(ValueCategory.YesNo, dlg._("Ok, so you want me to %s. Is that right?").format(description));
}

module.exports = async function ruleDialog(dlg, intent, confident, uniqueId, sourceIdentity) {
    let source = sourceIdentity ? await getIdentityName(dlg, sourceIdentity) : null;

    let program = intent.program;
    assert(program.isProgram);
    dlg.debug('About to execute program', program.prettyprint());

    // check for permission on the incomplete program first
    // this is an incomplete check, but we do it early before
    // asking questions to the user
    if (!await dlg.manager.user.canExecute(program)) {
        dlg.forbid();
        return;
    }

    let { ok, programType, hasTrigger, hasSlots, hasResult, icon } = await prepareProgram(dlg, program, source);
    if (!ok)
        return;

    let name = Describe.getProgramName(dlg.manager.gettext, program);
    let description = Describe.describeProgram(dlg.manager.gettext, program);

    if (!confident) {
        let confirmation = await confirm(dlg, description, source);
        if (!confirmation) {
            dlg.reset();
            return;
        }
        dlg.manager.stats.hit('sabrina-confirm');
    }

    ok = await slotFillProgram(dlg, program);
    if (!ok)
        return;

    program = await dlg.manager.user.applyPermissionRules(program);
    if (program === null) {
        dlg.forbid();
        return;
    }

    // update description after the slots are filled
    description = Describe.describeProgram(dlg.manager.gettext, program);
    // set the icon back to the program icon (icon might be changed inside slot filling)
    dlg.icon = icon;

    if (programType === 'general' && hasSlots) {
        let confirmation = await confirm(dlg, description, source);
        if (!confirmation) {
            dlg.reset();
            return;
        }
        dlg.manager.stats.hit('sabrina-confirm');
    }

    let echo = programType === 'safeAction' || ( confident && programType === 'general' && !hasSlots );
    if (echo) {
        if (source)
            dlg.reply(dlg._("I'm going to %s (as asked by %s).").format(description, source));
        else
            dlg.reply(dlg._("Ok, I'm going to %s.").format(description));
    }

    if (!uniqueId)
        uniqueId = 'uuid-' + uuid.v4();
    let appMeta = { $icon: icon||null };
    if (!hasTrigger)
        appMeta.$conversation = dlg.manager.id;
    [program, description, appMeta] = await dlg.manager.user.adjustProgram(program, description, appMeta);

    await dlg.manager.user.logProgramExecution(uniqueId, program, description, appMeta);

    const code = program.prettyprint(false);
    const app = await dlg.manager.apps.loadOneApp(code, appMeta, uniqueId, undefined,
                                                  name, description, true);

    await displayResult(dlg, app, { hasResult, echo });
};
