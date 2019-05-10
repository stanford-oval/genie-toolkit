// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const ruleDialog = require('./rule');
const discoveryDialog = require('./discovery');
const configDialog = require('./config');
const setupDialog = require('./setup');
const initDialog = require('./init');
const makeDialog = require('./make');
const { fallback, getExamples } = require('./fallback');
const askAnything = require('./ask_anything');
const permissionGrant = require('./permission_grant');
const permissionRuleDialog = require('./permission_rule');
const { showNotification, showError } = require('./notifications');

const Intent = require('../semantic').Intent;
const Helpers = require('../helpers');

async function handleUserInput(dlg, input) {
    let intent = input.intent;
    if (intent.isFailed) {
        await getExamples(dlg, intent.command);
    } else if (intent.isTrain) {
        await fallback(dlg, intent);
    } else if (intent.isUnsupported) {
        dlg.reply(dlg._("Sorry, I don't know how to do that yet."));
    } else if (intent.isYes) {
        dlg.manager.stats.hit('sabrina-command-egg');
        dlg.reply(dlg._("I agree, but to what?"));
    } else if (intent.isNo) {
        dlg.manager.stats.hit('sabrina-command-egg');
        dlg.reply(dlg._("No way!"));
    } else if (intent.isExample) {
        await Helpers.presentSingleExample(dlg, intent.utterance, intent.targetCode);
    } else if (intent.isProgram || intent.isPrimitive) {
        dlg.manager.stats.hit('sabrina-command-rule');
        await ruleDialog(dlg, intent, input.confident);
    } else if (intent.isHelp || intent.isMake) {
        dlg.manager.stats.hit('sabrina-command-make');
        await makeDialog(dlg, intent);
    } else if (intent.isSetup) {
        dlg.manager.stats.hit('sabrina-command-setup');
        await setupDialog(dlg, intent, input.confident);
    } else if (intent.isPermissionRule) {
        dlg.manager.stats.hit('sabrina-command-permissionrule');
        await permissionRuleDialog(dlg, intent, input.confident);
    } else {
        dlg.fail();
    }
}

function formatError(e) {
    if (e.name === 'SyntaxError')
        return "Syntax error at line " + e.lineNumber + ": " + e.message;
    else if (typeof e === 'string')
        return e;
    else if (e.message)
        return e.message;
    else
        return e;
}

async function loop(dlg, showWelcome) {
    await initDialog(dlg, showWelcome);

    let lastApp = undefined;
    for (;;) {
        try {
            dlg.icon = null;
            let { item: next, resolve, reject } = await dlg.nextQueueItem();

            try {
                let value;
                if (next.isUserInput) {
                    lastApp = undefined;
                    try {
                        value = await handleUserInput(dlg, next);
                    } catch(e) {
                        if (e.code !== 'ECANCELLED') {
                            dlg.reply(dlg._("Sorry, I had an error processing your command: %s").format(formatError(e)));
                            console.error(e);
                        }
                    }
                } else if (next.isNotification) {
                    value = await showNotification(dlg, next.appId, next.icon, next.outputType, next.outputValue, lastApp);
                    lastApp = next.appId;
                } else if (next.isError) {
                    value = await showError(dlg, next.appId, next.icon, next.error, lastApp);
                    lastApp = next.appId;
                } else if (next.isQuestion) {
                    lastApp = undefined;
                    value = await askAnything(dlg, next.appId, next.icon, next.type, next.question);
                } else if (next.isPermissionRequest) {
                    lastApp = undefined;
                    value = await permissionGrant(dlg, next.program, next.principal, next.identity);
                } else if (next.isInteractiveConfigure) {
                    lastApp = undefined;
                    if (next.kind !== null)
                        value = await configDialog(dlg, next.kind);
                    else
                        value = await discoveryDialog(dlg);
                } else if (next.isRunProgram) {
                    lastApp = undefined;
                    value = await ruleDialog(dlg, new Intent.Program(next.program, next.program, {}), true, next.uniqueId, next.identity);
                }

                resolve(value);
            } catch(e) {
                reject(e);
                if (e.code === 'ECANCELLED')
                    throw e;

                dlg.reply(dlg._("Sorry, that did not work: %s").format(formatError(e)));
                console.error(e);
            }
        } catch(e) {
            if (e.code === 'ECANCELLED')
                continue;
            throw e;
        }
    }
}

module.exports = loop;
