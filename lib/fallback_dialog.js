// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Sabrina
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');

const Dialog = require('./dialog');
const Helpers = require('./helpers');
const ValueCategory = require('./semantic').ValueCategory;

const reconstructCanonical = require('./reconstruct_canonical');

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

module.exports = class FallbackDialog extends Dialog {
    constructor() {
        super();

        this._initialized = false;
        this.raw = null;
        this.isTrain = false;
        this.isFailed = false;
        this.isFallback = false;

        this.fallbacks = null;
        this.canonicals = null;
        this.learn = false;

        this.target_json = null;
        this.target_canonical = null;
        this.rephrasing = false;
        this.confident = false;
    }

    _failWithOptions(examples) {
        this.manager.stats.hit('sabrina-fallback-buttons');

        examples = Helpers.filterExamples(sortExamples(this.raw, examples));

        return Helpers.augmentExamplesWithSlotTypes(this.manager.schemas, examples).then(() => {
            if (examples.length === 1) {
                this.target_json = examples[0].target_json;
                return this.ask(ValueCategory.YesNo, this._("Did you mean %s?").format(Helpers.presentExample(this, examples[0].tokens)));
            } else {
                if (this.manager.platform.type === 'android')
                    this.reply(this._("I did not understand that. Try the following instead, or use the Train button to teach me:"));
                else
                    this.reply(this._("I did not understand that. Try the following instead:"));
                Helpers.presentExampleList(this, examples.slice(0, 5));
                return this.switchToDefault();
            }
        });
    }

    _failCompletely() {
        this.reply(this._("Sorry, I did not understand that. Use ‘help’ to learn what I can do for you."));
        return this.switchToDefault();
    }

    _getExamples() {
        return this.manager.thingpedia.getExamplesByKey(this.raw, true).then((examples) => {
            if (examples.length === 0)
                return this._failCompletely();
            else
                return this._failWithOptions(examples);
        }).catch((e) => {
            console.error('Failed to run fallback search: ' + e.message);
            return this.switchToDefault();
        });
    }

    _failWithFallbacks() {
        // remove failuretoparse from the fallbacks
        // especially because reconstructCanonical is kind of dumb in reconstructing it
        this.fallbacks = this.fallbacks.filter((f) => f !== '{"special":{"id":"tt:root.special.failed"}}');

        return Q.all(this.fallbacks.map((f) => {
            return Q.try(() => {
                return reconstructCanonical(this, f);
            }).catch((e) => {
                console.log('Failed to reconstruct canonical from ' + f + ': ' + e.message);
                return null;
            });
        })).then((canonicals) => {
            this.canonicals = canonicals;

            var countCanonicals = 0;
            var singleCanonical = null;
            for (var i = 0; i < canonicals.length; i++) {
                if (canonicals[i] === null)
                    continue;
                if (singleCanonical === null)
                    singleCanonical = i;
                countCanonicals++;
            }

            if (countCanonicals === 0) {
                // go straight to the none of the above part
                if (this.rephrasing) {
                    return this.reply(this._("Sorry, you'll have to try and rephrase it once again."));
                } else {
                    this.rephrasing = true;
                    return this.reply(this._("I did not understand that. Can you rephrase it? I'll try to learn from your paraphrase."));
                }
            } else if (countCanonicals === 1) {
                this.target_json = this.fallbacks[singleCanonical];
                this.target_canonical = canonicals[singleCanonical];

                // if we rephrased and we're confident of the rephrasing, just run with it
                if (this.rephrasing && this.confident)
                    return this._runChosen();

                return this.ask(ValueCategory.YesNo, this._("Did you mean %s?").format(canonicals[0]));
            } else {
                if (this.isFallback && this.isTrain)
                    this.ask(ValueCategory.MultipleChoice, this._("Ok, how about…"));
                else
                    this.ask(ValueCategory.MultipleChoice, this._("Did you mean any of the following?"));

                var prev = null;
                var prevCanonical = null;
                for (var i = 0; i < canonicals.length; i++) {
                    if (canonicals[i] === null)
                        continue;
                    if (this.fallbacks[i] === prev)
                        continue;
                    if (canonicals[i] === prevCanonical) {
                        // this happens sometimes because we map different JSON forms to the
                        // same SemanticAnalyzer configuration, eg "list queries" and "list commands"
                        // or "discover hue" and "configure hue"
                        // all these are bugs and should be resolved in the grammar, but no need
                        // to show them off
                        console.error('Canonical is equal to prev canonical');
                        console.error('Previous was ' + prev);
                        console.error('Current is ' + this.fallbacks[i]);
                        continue;
                    }
                    this.replyChoice(i, "fallback choice", canonicals[i]);
                    prev = this.fallbacks[i];
                    prevCanonical = canonicals[i];
                }
                if (this.isTrain)
                    this.replyChoice(i, "fallback choice", this._("none of the above"));
                else
                    this.replyButton(this._("none of the above"), JSON.stringify({ special: 'tt:root.special.train' }));
                return true;
            }
        });
    }

    _runChosen() {
        this.manager.stats.hit('sabrina-fallback-successful');
        this.switchToDefault();

        if (this.learn) {
            this.manager.stats.hit('sabrina-online-learn');
            this.manager.sempre.onlineLearn(this.raw, this.target_json);

            var count = this.manager.stats.get('sabrina-online-learn');

            if (this.rephrasing)
                this.reply(this._("Thanks, I learned ‘%s’ as ‘%s’").format(this.raw, this.target_canonical));
            else
                this.reply(this._("Thanks, I made a note of that."));

            this.reply(this.ngettext("You have trained me with %d sentence.", "You have trained me with %d sentences.", count).format(count));
        }

        // handle the command at the next event loop iteration
        // to avoid reentrancy
        setImmediate(() => {
            this.manager.handleParsedCommand(this.target_json);
        });
        return true;
    }

    _setLearn() {
        // implement heuristic described in Sabrina._continueHandleCommand
        var tokens = Helpers.tokenize(this.raw).filter((t) => !STOP_WORDS.has(t));
        this.learn = tokens.length > 0;
    }

    handle(command) {
        // always handle train ourselves, without bouncing back to DefaultDialog
        if (command.isTrain)
            return this._continue(command);

        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;

            return this._continue(command);
        });
    }

    _continue(command) {
        this._initialized = true;

        if (this.raw === null) {
            if (command.isFailed) {
                this.raw = command.raw;
                this._setLearn();
                return this._getExamples();
            }
            if (command.isFallback) {
                this.isFallback = true;
                this.raw = command.raw;
                this.confident = false;
                this.fallbacks = command.fallbacks;
                this._setLearn();
                return this._failWithFallbacks();
            }
            if (command.isTrain) {
                this.raw = command.raw;
                this.confident = false;
                if (this.raw === null) {
                    this.reply(this._("Your last command was a button. I know what a button means. 😛"));
                    return this.switchToDefault();
                }
                this._setLearn();
            }
        }
        if (command.isTrain) {
            this.isTrain = true;
            this.fallbacks = command.fallbacks;
            if (this.fallbacks === null) {
                this.reply(this._("You haven't told me anything yet, so I cannot learn."));
                return this.switchToDefault();
            }
            return this._failWithFallbacks();
        }

        if (this.expecting === ValueCategory.YesNo &&
            this.target_json !== null) {
            if (command.isYes) {
                return this._runChosen();
            } else {
                return this.reset();
            }
        }

        if (this.expecting === ValueCategory.MultipleChoice) {
            var index = command.value;
            if (index !== Math.floor(index) ||
                index < 0 ||
                index > this.fallbacks.length) {
                this.reply(this._("Please click on one of the provided choices."));
                return true;
            } else if (index === this.fallbacks.length) {
                this.reply(this._("Ok, can you rephrase that?"));
                this.expecting = null;
                this.rephrasing = true;
                return true;
            } else {
                this.target_canonical = this.canonicals[index];
                this.target_json = this.fallbacks[index];
                return this._runChosen();
            }
        }

        if (this.rephrasing) {
            if (command.isFailed)
                return this.reply(this._("Sorry, you'll have to try and rephrase it once again."));
            if (command.isTrain)
                return this.reply(this._("I'm a little confused, I'm already in training mode, why are you asking me to train again?"));
            if (command.isFallback || command.isTrain) {
                // do not set this.raw, we we know to learn the original sentence
                this.confident = false;
                this.fallbacks = command.fallbacks;
                return this._failWithFallbacks();
            }
            // refuse to learn paraphrases of yes/no
            // (because ppdb works well for yes/no and because we want to keep them special)
            if (command.isNo)
                return this.reset();
            if (command.isYes)
                return this.reply(this._("Yes, you can? Then, well, do it..."));

            // refuse to learn paraphrases of specials and easter eggs
            // (because they just pollute the dataset)
            // just run with them
            if (command.raw === null || command.isSpecial || command.isEasterEgg || command.isAnswer) {
                this.manager.stats.hit('sabrina-fallback-ignored');
                this.switchToDefault();
                // handle the command at the next event loop iteration
                // to avoid reentrancy
                setImmediate(() => {
                    this.manager.handleParsedCommand(command.json);
                });
                return true;
            }

            // any other command was "confidently analyzed"
            this.confident = true;
            this.fallbacks = [command.json];
            return this._failWithFallbacks();
        }

        return false;
    }
}
