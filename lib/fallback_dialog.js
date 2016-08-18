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
      ".", "what", "?", "is", "are", "am", "be", "of"]);

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

function sortAndLimitExamples(raw, examples) {
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

    var jsonChoices = new Set();
    var toAdd = [];

    for (var ex of examples) {
        if (toAdd.length >= 5)
            break;

        if (jsonChoices.has(ex.target_json))
            continue;
        jsonChoices.add(ex.target_json);

        toAdd.push([Helpers.presentExample(ex.tokens), ex.target_json]);
    }

    return toAdd;
}

module.exports = class FallbackDialog extends Dialog {
    constructor() {
        super();

        this._initialized = false;
        this.raw = null;
        this.isFailed = false;
        this.isFallback = false;

        this.fallbacks = null;
        this.learn = false;

        this.target_json === null;
    }

    _failWithOptions(examples) {
        this.manager.stats.hit('sabrina-fallback-buttons');

        var toAdd = sortAndLimitExamples(this.raw, examples);

        if (toAdd.length === 1) {
            this.target_json = toAdd[0][1];
            return this.ask(ValueCategory.YesNo, this._("Did you mean %s?").format(toAdd[0][0]));
        } else {
            this.reply(this._("I did not understand that. Try the following instead:"));
            for (var i = 0; i < toAdd.length; i++)
                this.replyButton(toAdd[i][0], toAdd[i][1]);
            return this.switchToDefault();
        }
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
        return Q.all(this.fallbacks.map((f) => reconstructCanonical(this, f))).then((canonicals) => {
            if (canonicals.length === 1) {
                this.target_json = this.fallbacks[0];
                return this.ask(ValueCategory.YesNo, this._("Did you mean %s?").format(canonicals[0]));
            } else {
                this.ask(ValueCategory.MultipleChoice, this._("Did you mean any of the following?"));

                var prev = null;
                for (var i = 0; i < canonicals.length; i++) {
                    if (this.fallbacks[i] === prev)
                        continue;
                    prev = this.fallbacks[i];
                    this.replyChoice(i, "fallback choice", canonicals[i]);
                }
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
            this.reply(this._("Thanks, I made a note of that."));
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
        this.learn = tokens.length > 1;
    }

    handle(command) {
        // if this is the first command, bypass handleGeneric
        // this way we can handle tt:root.special.train without bouncing back
        // to defaultdialog, and we can do fallbacks on specials and other funny stuff
        if (!this._initialized)
            return this._continue(command);

        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;

            return this._continue(command);
        });
    }

    _continue(command) {
        this._initialized = true;

        if (command.isFailed && this.raw === null) {
            this.raw = command.raw;
            this._setLearn();
            return this._getExamples();
        }
        if (command.isFallback && this.raw === null) {
            this.raw = command.raw;
            this.fallbacks = command.fallbacks;
            this._setLearn();
            return this._failWithFallbacks();
        }
        if (command.isTrain) {
            this.raw = command.raw;
            this.fallbacks = command.fallbacks;
            if (this.fallbacks === null) {
                this.reply(this._("You haven't told me anything yet, so I cannot learn."));
                return this.switchToDefault();
            }
            if (this.raw === null) {
                this.reply(this._("Your last command was a button. I know what a button means. 😛"));
                return this.switchToDefault();
            }

            if (this.fallbacks.length > 20)
                this.fallbacks = this.fallbacks.slice(0, 20);
            this._setLearn();
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
                index >= this.fallbacks.length) {
                this.reply(this._("Please click on one of the provided choices."));
                return true;
            } else {
                this.target_json = this.fallbacks[index];
                return this._runChosen();
            }
        }

        return false;
    }
}
