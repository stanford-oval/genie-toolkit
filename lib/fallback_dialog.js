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

function tokenize(string) {
    var tokens = string.split(/(\s+|[,\.\"\'])/g);
    return tokens.filter((t) => !(/^\s*$/).test(t)).map((t) => t.toLowerCase());
}

function scoreExample(example, keyTokens) {
    var exampleTokens = tokenize(example.utterance);
    example.tokens = exampleTokens;

    // score is 2 for finding the right device kind,
    // 1 for each matched word and 0.5 for each matched
    // argument name

    var score = keyTokens.has(example.kind) >= 0 ? 2 : 0;

    for (var t of exampleTokens) {
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
    var keyTokens = new Set(tokenize(raw));
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

        var tokens = ex.tokens.map((t) => t.startsWith('$') ? '_____' : t);
        toAdd.push([tokens.join(' '), ex.target_json]);
    }

    return toAdd;
}

module.exports = class FallbackDialog extends Dialog {
    constructor(raw) {
        super();

        this.raw = raw;
        this.target_json === null;
    }

    _ensureBing() {
        var bing = this.manager.devices.getDevice('com.bing');
        if (bing !== undefined)
            return Q(bing);

        return this.manager.devices.loadOneDevice({ kind: 'com.bing' });
    }

    _failWithSearch() {
        return this._ensureBing().then((bing) => {
            return bing.getQuery('web_search');
        }).then((query) => {
            return query.invokeQuery([this.raw]).then((results) => {
                this.reply("Sorry, I did not understand that. Searching the web for \"" + this.raw + "\" instead");

                results.forEach((r) => {
                    Helpers.notify(this, undefined, query.formatEvent(r, [this.raw]));
                });
            }).finally(() => {
                return query.close();
            });
        }).finally(() => {
            this.switchToDefault();
        });
    }

    _failWithOptions(examples) {
        var toAdd = sortAndLimitExamples(this.raw, examples);

        if (toAdd.length === 1) {
            this.ask(ValueCategory.YesNo, "Sorry I did not understand that. Did you mean " + toAdd[0][0] + "?");
            this.target_json = toAdd[0][1];
        } else {
            this.reply("Sorry, I did not understand that. You can try the following instead:");
            for (var i = 0; i < toAdd.length; i++)
                this.replyButton((i+1) + ") " + toAdd[i][0], toAdd[i][1]);
            this.switchToDefault();
        }
    }

    start() {
        this.manager.thingpedia.getExamplesByKey(this.raw, true).then((examples) => {
            if (examples.length === 0)
                return this._failWithSearch();
            else
                return this._failWithOptions(examples);
        }).catch((e) => {
            console.error('Failed to run fallback search: ' + e.message);
        }).done();
        return true;
    }

    handle(command) {
        if (this.handleGeneric(command))
            return true;

        if (this.expecting === ValueCategory.YesNo &&
            this.target_json !== null) {
            if (command.isYes) {
                this.switchToDefault();
                // handle the command at the next event loop iteration
                // to avoid reentrancy
                setImmediate(() => {
                    this.manager.handleCommand(null, this.target_json);
                });
                return true;
            } else {
                return this.reset();
            }
        }
    }
}
