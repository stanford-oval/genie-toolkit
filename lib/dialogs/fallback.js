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

const reconstructCanonical = require('../reconstruct_canonical');

// this is the same list of stop words SEMPRE uses
const STOP_WORDS = new Set(["in", "on", "a", "to", "with", "and",
      "\'", "\"", "``", "`", "\'\'", "a", "an", "the", "that", "which",
      ".", "what", "?", "is", "are", "am", "be", "of", "if", "me"]);

function scoreExample(example, keyTokens) {
    example.tokens = Helpers.tokenizeExample(example.utterance);

    // score is 2 for finding the right device kind,
    // 1 for each matched word and 0.5 for each matched
    // argument name

    var score = keyTokens.has(example.kind) >= 0 ? 2 : 0;

    for (var t of example.tokens) {
        if (t.startsWith('$')) {
            if (keyTokens.has(t.substr(1)))
                score += 0.5;
        } else {
            if (keyTokens.has(t))
                score += 1;
        }
    }

    example.score = score;
}

function sortExamples(raw, examples) {
    var keyTokens = new Set(Helpers.tokenize(raw));
    for (var ex of examples) {
        scoreExample(ex, keyTokens);
    }

    // find max score, then find all examples with max score
    // this lets us use the most words in what the user said,
    // and increases the opportunity for a "did you mean foo?"
    // question
    var maxScore = undefined;
    for (var ex of examples)
        maxScore = maxScore !== undefined ? Math.max(ex.score, maxScore) : ex.score;
    examples = examples.filter((ex) => ex.score === maxScore);

    return examples;
}

function* failWithOptions(dlg, raw, examples) {
    dlg.manager.stats.hit('sabrina-fallback-buttons');

    examples = Helpers.filterExamples(sortExamples(raw, examples));

    yield Helpers.augmentExamplesWithSlotTypes(dlg.manager.schemas, examples);

    var looksLikeRule = raw.indexOf(dlg._("if ")) >= 0;

    if (!looksLikeRule && examples.length === 1) {
        let target_json = examples[0].target_json;
        let confirm = yield dlg.ask(ValueCategory.YesNo, dlg._("Did you mean %s?").format(Helpers.presentExample(dlg, examples[0].tokens)));
        if (confirm)
            return target_json;
        else
            return null;
    } else {
        if (dlg.manager.platform.type === 'android')
            dlg.reply(dlg._("I did not understand that. Try the following instead, or use the Train button to teach me:"));
        else
            dlg.reply(dlg._("I did not understand that. Try the following instead:"));
        Helpers.presentExampleList(dlg, examples.slice(0, 5));

        // Add "make rule" if raw looks like a rule
        if (looksLikeRule)
            dlg.replyButton(dlg._("Make Your Own Rule"), JSON.stringify({command: {type: 'make', value: {value: 'rule'}}}));

        return null;
    }
}

function failCompletely(dlg) {
    dlg.reply(dlg._("Sorry, I did not understand that. Use ‘help’ to learn what I can do for you."));
    return null;
}

function* getExamples(dlg, raw) {
    let examples = yield dlg.manager.thingpedia.getExamplesByKey(raw, true);
    if (examples.length === 0)
        return failCompletely();
    else
        return yield* failWithOptions(dlg, raw, examples);
}

function* rephrase(dlg) {
    while (true) {
        let command = yield dlg.expect(null);

        if (command.isFailed) {
            dlg.reply(dlg._("Sorry, you'll have to try and rephrase it once again."));
            continue;
        }
        if (command.isTrain) {
            dlg.reply(dlg._("I'm a little confused, I'm already in training mode, why are you asking me to train again?"));
            continue;
        }
        if (command.isFallback) {
            // do not set this.raw, we we know to learn the original sentence
            return yield* failWithFallbacks(dlg, command.fallbacks, false, true);
        }
        // refuse to learn paraphrases of yes/no
        // (because ppdb works well for yes/no and because we want to keep them special)
        if (command.isNo) {
            dlg.reset();
            return null;
        }
        if (command.isYes) {
            dlg.reply(dlg._("Yes, you can? Then, well, do it..."));
            continue;
        }

        // refuse to learn paraphrases of anything but help, rules and primitives
        // (because they just pollute the dataset)
        // just run with them
        if (command.raw === null || (!command.isHelp && !command.isRule && !command.isPrimitive && !command.isSetup)) {
            dlg.manager.stats.hit('sabrina-fallback-ignored');
            // handle the command at the next event loop iteration
            // to avoid reentrancy
            setImmediate(() => {
                dlg.manager.handleParsedCommand(command.json);
            });
            return null;
        }

        return command.json;
    }
}

function* failWithFallbacks(dlg, fallbacks, isTrain, rephrasing) {
    // remove failuretoparse from the fallbacks
    // especially because reconstructCanonical is kind of dumb in reconstructing it
    fallbacks = fallbacks.filter((f) => f !== '{"special":{"id":"tt:root.special.failed"}}');

    let canonicals = yield Promise.all(fallbacks.map((f) => {
        return Q.try(() => {
            return reconstructCanonical(dlg, JSON.parse(f));
        }).catch((e) => {
            console.log('Failed to reconstruct canonical from ' + f + ': ' + e.message);
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
        // go straight to the none of the above part
        if (rephrasing) {
            dlg.reply(dlg._("Sorry, you'll have to try and rephrase it once again."));
        } else {
            dlg.reply(dlg._("I did not understand that. Can you rephrase it? I'll try to learn from your paraphrase."));
        }

        return yield* rephrase(dlg);
    } else if (countCanonicals === 1) {
        let target_json = fallbacks[singleCanonical];
        let target_canonical = canonicals[singleCanonical];

        let ok = yield dlg.ask(ValueCategory.YesNo, dlg._("Did you mean %s?").format(target_canonical));
        if (ok)
            return target_json;
        else
            return null;
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
        let train = JSON.stringify({ special: 'tt:root.special.train' });
        // this is a little dirty because we need to send both the normal
        // choice buttons and a json button
        let beforeLast = null;
        if (isTrain)
            choices.push([train, dlg._("none of the above")]);
        else
            beforeLast = () => dlg.replyButton(dlg._("none of the above"), train);

        let idx = yield dlg.askChoices(dlg._("Did you mean any of the following?"), choices.map(([json, text]) => text), beforeLast);
        if (idx === choices.length - 1) {
            dlg.reply(dlg._("Ok, can you rephrase that?"));
            return yield* rephrase(dlg);
        } else {
            return choices[idx][0];
        }
    }
}

module.exports = function* fallback(dlg, intent) {
    let raw = null;
    let chosen = null;

    let rephrasing = false;
    let target_canonical = null;
    if (intent.isFailed) {
        raw = intent.raw;
        chosen = yield* getExamples(dlg, raw);
    }
    if (intent.isFallback || intent.isTrain) {
        raw = intent.raw;
        if (raw === null) {
            dlg.reply(dlg._("Your last command was a button. I know what a button means. 😛"));
            return;
        }
        chosen = yield* failWithFallbacks(dlg, intent.fallbacks, intent.isTrain, false);
    }
    // implement heuristic described in Almond._continueHandleCommand
    let tokens = Helpers.tokenize(raw).filter((t) => !STOP_WORDS.has(t));
    let learn = tokens.length > 0;

    if (!chosen)
        return;

    dlg.manager.stats.hit('sabrina-fallback-successful');

    if (learn) {
        dlg.manager.stats.hit('sabrina-online-learn');
        dlg.manager.parser.onlineLearn(raw, chosen);

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
        dlg.manager.handleParsedCommand(chosen);
    });
    return true;
}
