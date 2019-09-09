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
const Describe = ThingTalk.Describe;

const { Intent, ValueCategory } = require('../semantic');
const Helpers = require('../helpers');

function makeContext() {
    return {
        command: null,
        previousCommand: null,
        previousCandidates: [],
        platformData: {}
    };
}

async function reconstructCanonical(dlg, code, entities) {
    const intent = await Intent.parse({ code, entities }, dlg.manager.schemas, makeContext());
    if (intent.isExample || intent.isUnsupported || intent.isFailed)
        throw new Error('Invalid internal intent ' + intent);

    const describer = new Describe.Describer(dlg.manager.gettext, dlg.manager.locale, dlg.manager.timezone);
    return describer.describe(intent.thingtalk);
}

const ENABLE_SUGGESTIONS = false;

async function getExamples(dlg, command) {
    const dataset = await dlg.manager.thingpedia.getExamplesByKey(command);
    const examples = ENABLE_SUGGESTIONS ? await Helpers.loadExamples(dlg, dataset, 5) : [];

    if (examples.length === 0) {
        await dlg.reply(dlg._("Sorry, I did not understand that. Use ‘help’ to learn what I can do for you."));
        return;
    }

    dlg.manager.stats.hit('sabrina-fallback-buttons');

    // don't sort the examples, they come already sorted from Thingpedia

    var looksLikeRule = command.indexOf(dlg._("if")) >= 0;

    if (dlg.manager.platform.type === 'android')
        await dlg.reply(dlg._("Sorry, I did not understand that. Try the following instead, or use the Train button to teach me:"));
    else
        await dlg.reply(dlg._("Sorry, I did not understand that. Try the following instead:"));

    Helpers.presentExampleList(dlg, examples);

    // Add "make rule" if raw looks like a rule
    if (looksLikeRule)
        await dlg.replySpecial(dlg._("Make Your Own Rule"), 'makerule');
}

async function failWithFallbacks(dlg, command, fallbacks) {
    let canonicals = await Promise.all(fallbacks.map((f) => {
        return Promise.resolve().then(() => {
            return reconstructCanonical(dlg, f.code, command.entities);
        }).catch((e) => {
            console.log('Failed to reconstruct canonical from ' + f.code.join(' ') + ': ' + e.message);
            return null;
        });
    }));

    let countCanonicals = 0;
    let singleCanonical = null;
    for (var i = 0; i < canonicals.length; i++) {
        if (canonicals[i] === null)
            continue;
        if (singleCanonical === null)
            singleCanonical = i;
        countCanonicals++;
    }

    if (countCanonicals === 0) {
        dlg.fail();
        return null;
    } else if (countCanonicals === 1) {
        let target = fallbacks[singleCanonical];
        let target_canonical = canonicals[singleCanonical];

        let ok = await dlg.ask(ValueCategory.YesNo, dlg._("Did you mean %s?").format(target_canonical));
        if (ok) {
            return target;
        } else {
            dlg.reset();
            return null;
        }
    } else {
        let choices = [];
        let prev = null;
        let seenCanonicals = new Set;
        for (let i = 0; i < canonicals.length; i++) {
            if (canonicals[i] === null)
                continue;
            if (fallbacks[i] === prev)
                continue;
            if (seenCanonicals.has(canonicals[i])) {
                // this happens sometimes due to the exact matcher duplicating
                // some results from the regular matcher, ignore it
                continue;
            }
            seenCanonicals.add(canonicals[i]);
            choices.push([fallbacks[i], canonicals[i]]);
            prev = fallbacks[i];
        }
        choices.push([null, dlg._("none of the above")]);

        let idx = await dlg.askChoices(dlg._("Did you mean any of the following?"), choices.map(([json, text]) => text));
        if (idx === choices.length - 1) {
            dlg.reset();
            return null;
        } else {
            return choices[idx][0];
        }
    }
}

async function fallback(dlg, intent) {
    assert(intent.isTrain);
    const command = intent.command;
    if (command === null) {
        await dlg.reply(dlg._("Your last command was a button. I know what a button means. 😛"));
        return;
    }
    const chosen = await failWithFallbacks(dlg, command, intent.fallbacks);

    let tokens = command.tokens;
    let learn = tokens.length > 0;

    if (!chosen)
        return;

    dlg.manager.stats.hit('sabrina-fallback-successful');

    if (learn) {
        dlg.manager.stats.hit('sabrina-online-learn');
        dlg.manager.parser.onlineLearn(command.utterance, chosen.code);

        const prefs = dlg.manager.platform.getSharedPreferences();
        let count = prefs.get('almond-online-learn-count');
        if (count === undefined)
            count = 0;
        count++;
        prefs.set('almond-online-learn-count', count);

        await dlg.reply(dlg._("Thanks, I made a note of that."));
        await dlg.reply(dlg.ngettext("You have trained me with %d sentence.", "You have trained me with %d sentences.", count).format(count));
    }

    // handle the command at the next event loop iteration
    // to avoid reentrancy
    //
    // FIXME: instead, we should run this immediately, inside this promise, and not return
    // until the whole task is done
    //
    // (except we don't do this inside auto_test_almond cause it breaks the test script)
    if (dlg.manager._options.testMode)
        return;
    setImmediate(() => {
        dlg.manager.handleParsedCommand({ code: chosen.code, entities: command.entities });
    });
}

module.exports = {
    fallback,
    getExamples
};
