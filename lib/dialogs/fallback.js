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

const ValueCategory = require('../semantic').ValueCategory;
const Helpers = require('../helpers');

const reconstructCanonical = require('../reconstruct_canonical');

async function getExamples(dlg, command) {
    const dataset = await dlg.manager.thingpedia.getExamplesByKey(command.tokens.join(' '));
    const examples = await Helpers.loadExamples(dlg, dataset, 5);

    if (examples.length === 0) {
        dlg.reply(dlg._("Sorry, I did not understand that. Use ‘help’ to learn what I can do for you."));
        return;
    }

    dlg.manager.stats.hit('sabrina-fallback-buttons');

    // don't sort the examples, they come already sorted from Thingpedia

    var looksLikeRule = command.tokens.indexOf(dlg._("if")) >= 0;

    if (dlg.manager.platform.type === 'android')
        dlg.reply(dlg._("Sorry, I did not understand that. Try the following instead, or use the Train button to teach me:"));
    else
        dlg.reply(dlg._("Sorry, I did not understand that. Try the following instead:"));

    Helpers.presentExampleList(dlg, examples);

    // Add "make rule" if raw looks like a rule
    if (looksLikeRule)
        dlg.replySpecial(dlg._("Make Your Own Rule"), 'makerule');
}

async function failWithFallbacks(dlg, command, fallbacks) {
    let canonicals = await Promise.all(fallbacks.map((f) => {
        return Promise.resolve().then(() => {
            return reconstructCanonical(dlg, f.code, command.entities);
        }).catch((e) => {
            console.log('Failed to reconstruct canonical from ' + f.code.join(' ') + ': ' + e.message);
            console.log(e.stack);
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
        let prevCanonical = null;
        for (let i = 0; i < canonicals.length; i++) {
            if (canonicals[i] === null)
                continue;
            if (fallbacks[i] === prev)
                continue;
            if (canonicals[i] === prevCanonical) {
                // this happens sometimes because we map different JSON forms to the
                // same Intent configuration, eg "list queries" and "list commands"
                // or "discover hue" and "configure hue"
                // all these are bugs and should be resolved in the grammar, but no need
                // to show them off
                console.error('Canonical is equal to prev canonical');
                console.error('Previous was ' + prev);
                console.error('Current is ' + fallbacks[i]);
                continue;
            }
            choices.push([fallbacks[i], canonicals[i]]);
            prev = fallbacks[i];
            prevCanonical = canonicals[i];
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

module.exports = async function fallback(dlg, intent) {
    if (intent.isFailed) {
        await getExamples(dlg, intent.command);
        return true;
    }

    assert(intent.isTrain);
    const command = intent.command;
    if (command === null) {
        dlg.reply(dlg._("Your last command was a button. I know what a button means. 😛"));
        return true;
    }
    const chosen = await failWithFallbacks(dlg, command, intent.fallbacks);

    let tokens = command.tokens;
    let learn = tokens.length > 0;

    if (!chosen)
        return true;

    dlg.manager.stats.hit('sabrina-fallback-successful');

    if (learn) {
        dlg.manager.stats.hit('sabrina-online-learn');
        dlg.manager.parser.onlineLearn(command.utterance, chosen.code);

        let count = dlg.manager.stats.get('sabrina-online-learn');

        dlg.reply(dlg._("Thanks, I made a note of that."));
        dlg.reply(dlg.ngettext("You have trained me with %d sentence.", "You have trained me with %d sentences.", count).format(count));
    }

    // handle the command at the next event loop iteration
    // to avoid reentrancy
    //
    // FIXME: instead, we should run this immediately, inside this promise, and not return
    // until the whole task is done
    //
    setImmediate(() => {
        dlg.manager.handleParsedCommand({ code: chosen.code, entities: command.entities });
    });
    return true;
};
