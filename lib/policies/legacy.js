// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2017-2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const ruleDialog = require('../legacy-dialogs/rule');
const discoveryDialog = require('../legacy-dialogs/discovery');
const configDialog = require('../legacy-dialogs/config');
const makeDialog = require('../legacy-dialogs/make');
const { fallback, getExamples } = require('../legacy-dialogs/fallback');
const askAnything = require('../legacy-dialogs/ask_anything');
const permissionGrant = require('../legacy-dialogs/permission_grant');
const permissionRuleDialog = require('../legacy-dialogs/permission_rule');
const { showNotification, showError } = require('../legacy-dialogs/notifications');

const Intent = require('../semantic').Intent;
const Helpers = require('../helpers');

async function handleAPICall(dlg, call, lastApp) {
    let value;
    if (call.isNotification) {
        value = await showNotification(dlg, call.appId, call.icon, call.outputType, call.outputValue, lastApp);
        lastApp = call.appId;
    } else if (call.isError) {
        value = await showError(dlg, call.appId, call.icon, call.error, lastApp);
        lastApp = call.appId;
    } else if (call.isQuestion) {
        lastApp = undefined;
        value = await askAnything(dlg, call.appId, call.icon, call.type, call.question);
    } else if (call.isPermissionRequest) {
        lastApp = undefined;
        value = await permissionGrant(dlg, call.program, call.principal, call.identity);
    } else if (call.isInteractiveConfigure) {
        lastApp = undefined;
        if (call.kind !== null)
            value = await configDialog(dlg, call.kind);
        else
            value = await discoveryDialog(dlg);
    } else if (call.isRunProgram) {
        lastApp = undefined;
        value = await ruleDialog(dlg, new Intent.Program(call.program, call.program, {}), true, call.uniqueId, call.identity);
    }

    return [value, lastApp];
}

async function handleInput(dlg, intent, confident) {
    if (intent.isFailed) {
        await getExamples(dlg, intent.command);
    } else if (intent.isTrain) {
        await fallback(dlg, intent);
    } else if (intent.isUnsupported) {
        await dlg.reply(dlg._("Sorry, I don't know how to do that yet."));
    } else if (intent.isYes) {
        dlg.manager.stats.hit('sabrina-command-egg');
        await dlg.reply(dlg._("I agree, but to what?"));
    } else if (intent.isNo) {
        dlg.manager.stats.hit('sabrina-command-egg');
        await dlg.reply(dlg._("No way!"));
    } else if (intent.isExample) {
        await Helpers.presentSingleExample(dlg, intent.utterance, intent.targetCode);
    } else if (intent.isProgram || intent.isPrimitive) {
        dlg.manager.stats.hit('sabrina-command-rule');
        await ruleDialog(dlg, intent, confident);
    } else if (intent.isHelp || intent.isMake) {
        dlg.manager.stats.hit('sabrina-command-make');
        await makeDialog(dlg, intent);
    } else if (intent.isPermissionRule) {
        dlg.manager.stats.hit('sabrina-command-permissionrule');
        await permissionRuleDialog(dlg, intent, confident);
    } else {
        dlg.fail();
    }
}

module.exports = {
    handleAPICall,
    handleInput,
};
