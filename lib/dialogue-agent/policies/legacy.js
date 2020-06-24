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

const { fallback, getExamples } = require('../legacy-dialogs/fallback');

const Semantic = require('../semantic');
const ValueCategory = Semantic.ValueCategory;
const Helpers = require('../helpers');
const { CancellationError } = require('../errors');

async function handleInput(dlg, intent, confident) {
    if (intent.isFailed)
        await getExamples(dlg, intent.command);
    else if (intent.isTrain)
        await fallback(dlg, intent);
    else if (intent.isUnsupported)
        await dlg.reply(dlg._("Sorry, I don't know how to do that yet."));
    else if (intent.isExample)
        await Helpers.presentSingleExample(dlg, intent.utterance, intent.targetCode);
    else
        dlg.fail();
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


module.exports = {
    legacyDialogueHandler,
};
