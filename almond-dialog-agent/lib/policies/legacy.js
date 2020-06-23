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

const Semantic = require('../semantic');
const Intent = Semantic.Intent;
const ValueCategory = Semantic.ValueCategory;
const Helpers = require('../helpers');
const { CancellationError } = require('../errors');

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

// FIXME this should move elsewhere
async function legacyHandleGeneric(dlg, command) {
    if (command.isFailed) {
        if (dlg.expecting !== null) {
            await dlg.fail();
            return true;
        }
        // don't handle this if we're not expecting anything
        // (it will fall through to whatever dialog.handle()
        // is doing, which is calling FallbackDialog for DefaultDialog,
        // actually showing the fallback for FallbackDialog,
        // and doing nothing for all other dialogs)
        return false;
    }
    if (command.isTrain) {
        // in the middle of a dialogue, reset and reinject
        if (dlg.expecting !== null)
            throw new CancellationError(command);

        // at the default state, handle normally
        return false;
    }
    if (command.isDebug) {
        if (dlg.expecting === null)
            await dlg.reply("I'm in the default state");
        else
            await dlg.reply("I'm expecting a " + dlg.expecting);
        //for (var key of this.manager.stats.keys())
        //    await this.reply(key + ": " + this.manager.stats.get(key));
        return true;
    }
    if (command.isHelp) {
        if (dlg.expecting !== null) {
            await dlg.lookingFor();
            return true;
        } else {
            return false;
        }
    }
    if (command.isWakeUp) // nothing to do
        return true;

    // if we're expecting the user to click on More... or press cancel,
    // three things can happen
    if (dlg.expecting === ValueCategory.More) {
        // if the user clicks more, more we let the intent through to rule.js
        if (command.isMore)
            return false;
        // if the user says no, cancel or stop, we inject the cancellation error but we don't show
        // a failure message to the user
        if (command.isNeverMind || command.isNo || command.isStop)
            throw new CancellationError();
        // if the user says anything else, we cancel the current dialog
        throw new CancellationError(command);
    }

    // stop means cancel, but without a failure message
    if (command.isStop)
        throw new CancellationError();
    if (command.isNeverMind) {
        await dlg.reset();
        throw new CancellationError();
    }

    if (dlg.expecting !== null && (!command.isAnswer || !command.category.equals(dlg.expecting))) {
        if (command.isNo) {
            await dlg.reset();
            throw new CancellationError();
        }
        if (dlg.expecting === ValueCategory.Password &&
            command.isAnswer && command.category === ValueCategory.RawString)
            return false;

        if (dlg.expecting === ValueCategory.Command &&
            (command.isProgram || command.isCommandList || command.isBack || command.isMore || command.isEmpty))
            return false;
        if (dlg.expecting === ValueCategory.Predicate &&
            (command.isPredicate || command.isBack || command.isMore))
            return false;
        if (dlg.expecting === ValueCategory.PermissionResponse &&
            (command.isPredicate || command.isPermissionRule || command.isMore || command.isYes || command.isMaybe || command.isBack))
            return false;

        // if given an answer of the wrong type have Almond complain
        if (command.isYes) {
            await dlg.reply(dlg._("Yes what?"));
            return true;
        }
        if (command.isAnswer) {
            await dlg.unexpected();
            return true;
        }

        // anything else, just switch the subject
        throw new CancellationError(command);
    }
    if (dlg.expecting === ValueCategory.MultipleChoice) {
        let index = command.value;
        if (index !== Math.floor(index) ||
            index < 0 ||
            index > dlg._choices.length) {
            await dlg.reply(dlg._("Please click on one of the provided choices."));
            await dlg.manager.resendChoices();
            return true;
        }
    }

    return false;
}

async function legacyDialogueHandler(dlg, input) {
    if (await legacyHandleGeneric(dlg, input.intent))
        return;

    dlg.setBeforeInput(legacyHandleGeneric);
    try {
        await handleInput(dlg, input.intent, input.confident);
    } finally {
        dlg.setBeforeInput(null);
    }
}


async function handleLegacyAPICall(dlg, input, lastApp) {
    dlg.setBeforeInput(legacyHandleGeneric);
    try {
        return await handleAPICall(dlg, input, lastApp);
    } finally {
        dlg.setBeforeInput(null);
    }
}

module.exports = {
    handleLegacyAPICall,
    legacyDialogueHandler,
};
